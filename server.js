const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

// ============================================
// TOKEN
// ============================================

function createPlayerToken() {
    return (
        Math.random().toString(36).substring(2) +
        Date.now().toString(36)
    );
}

// ============================================
// ROLLER
// ============================================

function createRoles(playerCount) {
    let roles = [];

    roles.push("Vampir");
    roles.push("Dedektif");

    if (playerCount >= 5) {
        roles.push("Doktor");
    }

    while (roles.length < playerCount) {
        roles.push("Köylü");
    }

    // Karıştır
    for (let i = roles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    return roles;
}

// ============================================
// OYUNCULAR
// ============================================

function getAlivePlayers(room) {
    return room.players.filter(player => player.alive);
}

// ============================================
// OYUNCU LİSTESİ GÖNDER
// ============================================

function sendPlayers(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    const players = room.players.map(player => ({
        id: player.id,
        username: player.username,
        alive: player.alive
    }));

    console.log(
        "OYUNCU LİSTESİ GÖNDERİLİYOR:",
        roomCode,
        players
    );

    io.to(roomCode).emit("gamePlayers", players);
}

// ============================================
// KAZANMA KONTROLÜ
// ============================================

function checkWin(roomCode) {
    const room = rooms[roomCode];

    if (!room) {
        return true;
    }

    const alive = getAlivePlayers(room);

    const vampires = alive.filter(
        player => player.role === "Vampir"
    );

    const villagers = alive.filter(
        player => player.role !== "Vampir"
    );

    // Vampir kalmadı
    if (vampires.length === 0) {
        room.gameStarted = false;
        room.phase = "gameover";

        if (room.phaseTimer) {
            clearTimeout(room.phaseTimer);
        }

        io.to(roomCode).emit("gameOver", {
            winner: "Köylüler"
        });

        return true;
    }

    // Vampirler eşit veya fazla
    if (vampires.length >= villagers.length) {
        room.gameStarted = false;
        room.phase = "gameover";

        if (room.phaseTimer) {
            clearTimeout(room.phaseTimer);
        }

        io.to(roomCode).emit("gameOver", {
            winner: "Vampirler"
        });

        return true;
    }

    return false;
}

// ============================================
// OYUN DURUMUNU GÖNDER
// ============================================

function sendGameState(socket) {
    const roomCode = socket.roomCode;
    const room = rooms[roomCode];

    if (!room) {
        socket.emit(
            "roomError",
            "Oda bulunamadı."
        );

        return;
    }

    const player = room.players.find(
        p =>
            p.id === socket.id ||
            p.token === socket.playerToken
    );

    if (!player) {
        socket.emit(
            "roomError",
            "Oyuncu bulunamadı."
        );

        return;
    }

    const oldId = player.id;

    // Yeni socket ID
    player.id = socket.id;

    socket.roomCode = roomCode;
    socket.username = player.username;
    socket.playerToken = player.token;

    socket.join(roomCode);

    // Host yeniden bağlandı
    if (room.host === oldId) {
        room.host = socket.id;

        console.log(
            "HOST YENİDEN BAĞLANDI:",
            player.username
        );
    }

    // Oyun başladıysa rolü gönder
    if (room.gameStarted) {
        socket.emit("gameStarted", {
            username: player.username,
            role: player.role,
            roomCode: roomCode
        });
    }

    // Oyuncular
    socket.emit(
        "gamePlayers",
        room.players.map(p => ({
            id: p.id,
            username: p.username,
            alive: p.alive
        }))
    );

    // Faz
    if (room.phase !== "lobby") {
        socket.emit("phaseChanged", {
            phase: room.phase,
            duration: room.phaseDuration,
            endTime: room.phaseEndTime
        });
    }

    // Gece
    if (
        room.phase === "night" &&
        player.alive
    ) {
        socket.emit("nightStarted", {
            role: player.role
        });
    }

    // Oylama
    if (
        room.phase === "voting" &&
        player.alive
    ) {
        socket.emit("votingStarted");
    }
}

// ============================================
// FAZ
// ============================================

function setPhase(roomCode, phase, duration) {
    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    if (room.phaseTimer) {
        clearTimeout(room.phaseTimer);
    }

    room.phase = phase;
    room.phaseDuration = duration;

    room.phaseEndTime =
        Date.now() + duration * 1000;

    console.log(
        "FAZ:",
        roomCode,
        phase
    );

    io.to(roomCode).emit(
        "phaseChanged",
        {
            phase: phase,
            duration: duration,
            endTime: room.phaseEndTime
        }
    );
}

// ============================================
// GECE
// ============================================

function startNight(roomCode) {
    const room = rooms[roomCode];

    if (
        !room ||
        !room.gameStarted
    ) {
        return;
    }

    room.vampireTarget = null;
    room.doctorTarget = null;
    room.detectiveTarget = null;

    setPhase(
        roomCode,
        "night",
        30
    );

    room.players.forEach(player => {
        if (!player.alive) {
            return;
        }

        io.to(player.id).emit(
            "nightStarted",
            {
                role: player.role
            }
        );
    });

    room.phaseTimer = setTimeout(() => {
        finishNight(roomCode);
    }, 30000);
}

// ============================================
// GECEYİ BİTİR
// ============================================

function finishNight(roomCode) {
    const room = rooms[roomCode];

    if (
        !room ||
        !room.gameStarted
    ) {
        return;
    }

    let killedPlayer = null;

    if (room.vampireTarget) {
        const target = room.players.find(
            p =>
                p.id ===
                room.vampireTarget
        );

        if (
            target &&
            target.alive
        ) {
            if (
                room.doctorTarget !==
                target.id
            ) {
                target.alive = false;
                killedPlayer = target;
            }
        }
    }

    if (killedPlayer) {
        io.to(roomCode).emit(
            "nightResult",
            {
                killed:
                    killedPlayer.username
            }
        );
    } else {
        io.to(roomCode).emit(
            "nightResult",
            {
                killed: null
            }
        );
    }

    sendPlayers(roomCode);

    if (checkWin(roomCode)) {
        return;
    }

    room.phaseTimer = setTimeout(() => {
        startDiscussion(roomCode);
    }, 4000);
}

// ============================================
// TARTIŞMA
// ============================================

function startDiscussion(roomCode) {
    const room = rooms[roomCode];

    if (
        !room ||
        !room.gameStarted
    ) {
        return;
    }

    setPhase(
        roomCode,
        "discussion",
        30
    );

    room.phaseTimer = setTimeout(() => {
        startVoting(roomCode);
    }, 30000);
}

// ============================================
// OYLAMA
// ============================================

function startVoting(roomCode) {
    const room = rooms[roomCode];

    if (
        !room ||
        !room.gameStarted
    ) {
        return;
    }

    room.votes = {};

    setPhase(
        roomCode,
        "voting",
        20
    );

    io.to(roomCode).emit(
        "votingStarted"
    );

    room.phaseTimer = setTimeout(() => {
        finishVoting(roomCode);
    }, 20000);
}

// ============================================
// OYLARI SAY
// ============================================

function finishVoting(roomCode) {
    const room = rooms[roomCode];

    if (
        !room ||
        !room.gameStarted
    ) {
        return;
    }

    const voteCounts = {};

    Object.values(room.votes).forEach(
        targetId => {
            if (!voteCounts[targetId]) {
                voteCounts[targetId] = 0;
            }

            voteCounts[targetId]++;
        }
    );

    let highestVotes = 0;
    let candidates = [];

    Object.entries(voteCounts).forEach(
        ([id, votes]) => {

            if (
                votes >
                highestVotes
            ) {
                highestVotes = votes;
                candidates = [id];

            } else if (
                votes ===
                highestVotes
            ) {
                candidates.push(id);
            }
        }
    );

    // Kimse oy vermedi
    if (candidates.length === 0) {

        io.to(roomCode).emit(
            "executionResult",
            {
                executed: null,
                message:
                    "Kimse oy vermedi."
            }
        );

        room.phaseTimer = setTimeout(() => {
            startNight(roomCode);
        }, 4000);

        return;
    }

    // Eşit oy
    if (candidates.length > 1) {

        io.to(roomCode).emit(
            "executionResult",
            {
                executed: null,
                message:
                    "Oylar eşit! Kimse asılmadı."
            }
        );

        room.phaseTimer = setTimeout(() => {
            startNight(roomCode);
        }, 4000);

        return;
    }

    const executedPlayer =
        room.players.find(
            player =>
                player.id ===
                candidates[0]
        );

    if (executedPlayer) {

        executedPlayer.alive = false;

        io.to(roomCode).emit(
            "executionResult",
            {
                executed:
                    executedPlayer.username,

                role:
                    executedPlayer.role,

                votes:
                    highestVotes
            }
        );
    }

    sendPlayers(roomCode);

    if (checkWin(roomCode)) {
        return;
    }

    room.phaseTimer = setTimeout(() => {
        startNight(roomCode);
    }, 5000);
}

// ============================================
// SOCKET.IO
// ============================================

io.on("connection", socket => {

    console.log(
        "================================="
    );

    console.log(
        "YENİ BAĞLANTI:",
        socket.id
    );

    console.log(
        "================================="
    );

    // ========================================
    // OYUN DURUMUNU İSTE
    // ========================================

    socket.on(
        "requestGameState",
        data => {

            console.log(
                "GAME STATE İSTEĞİ:",
                data
            );

            if (
                !data ||
                !data.roomCode ||
                !data.token
            ) {
                socket.emit(
                    "roomError",
                    "Oyun bilgileri eksik."
                );

                return;
            }

            const roomCode =
                String(data.roomCode)
                    .trim()
                    .toUpperCase();

            const token =
                String(data.token);

            const room =
                rooms[roomCode];

            if (!room) {

                console.log(
                    "ODA BULUNAMADI:",
                    roomCode
                );

                socket.emit(
                    "roomError",
                    "Oda bulunamadı."
                );

                return;
            }

            const player =
                room.players.find(
                    p =>
                        p.token ===
                        token
                );

            if (!player) {

                console.log(
                    "TOKEN BULUNAMADI"
                );

                socket.emit(
                    "roomError",
                    "Oyuncu bulunamadı."
                );

                return;
            }

            player.id = socket.id;

            socket.roomCode =
                roomCode;

            socket.username =
                player.username;

            socket.playerToken =
                token;

            socket.join(roomCode);

            if (
                room.host ===
                player.id
            ) {
                room.host =
                    socket.id;
            }

            console.log(
                "OYUNCU YENİ SOCKET'E BAĞLANDI:",
                player.username,
                socket.id
            );

            sendGameState(socket);
            sendPlayers(roomCode);
        }
    );

    // ========================================
    // ODA OLUŞTUR
    // ========================================

    socket.on(
        "createRoom",
        username => {

            console.log(
                "CREATE ROOM:",
                username
            );

            username =
                String(username)
                    .trim();

            if (!username) {

                socket.emit(
                    "roomError",
                    "Kullanıcı adı gerekli."
                );

                return;
            }

            let roomCode;

            do {

                roomCode =
                    Math.random()
                        .toString(36)
                        .substring(2, 8)
                        .toUpperCase();

            } while (
                rooms[roomCode]
            );

            const token =
                createPlayerToken();

            rooms[roomCode] = {

                host:
                    socket.id,

                players:
                    [],

                gameStarted:
                    false,

                phase:
                    "lobby",

                phaseDuration:
                    0,

                phaseEndTime:
                    0,

                phaseTimer:
                    null,

                votes:
                    {},

                vampireTarget:
                    null,

                doctorTarget:
                    null,

                detectiveTarget:
                    null
            };

            rooms[roomCode]
                .players
                .push({

                    id:
                        socket.id,

                    token:
                        token,

                    username:
                        username,

                    role:
                        null,

                    alive:
                        true
                });

            socket.roomCode =
                roomCode;

            socket.username =
                username;

            socket.playerToken =
                token;

            socket.join(roomCode);

            console.log(
                "ODA OLUŞTURULDU:",
                roomCode
            );

            console.log(
                "OYUNCULAR:",
                rooms[roomCode].players
            );

            socket.emit(
                "roomCreated",
                {
                    roomCode:
                        roomCode,

                    token:
                        token
                }
            );

            sendPlayers(roomCode);
        }
    );

    // ========================================
    // ODAYA KATIL
    // ========================================

    socket.on(
        "joinRoom",
        (data, callback) => {

            console.log(
                "================================="
            );

            console.log(
                "JOIN İSTEĞİ GELDİ"
            );

            console.log(
                "DATA:",
                data
            );

            console.log(
                "SOCKET:",
                socket.id
            );

            console.log(
                "================================="
            );

            if (!data) {

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Veri alınamadı."
                    });
                }

                return;
            }

            const username =
                String(
                    data.username || ""
                ).trim();

            const roomCode =
                String(
                    data.roomCode || ""
                )
                    .trim()
                    .toUpperCase();

            console.log(
                "USERNAME:",
                username
            );

            console.log(
                "ROOM CODE:",
                roomCode
            );

            if (!username) {

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Kullanıcı adı gerekli."
                    });
                }

                return;
            }

            if (!roomCode) {

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Oda kodu gerekli."
                    });
                }

                return;
            }

            const room =
                rooms[roomCode];

            if (!room) {

                console.log(
                    "❌ ODA BULUNAMADI:",
                    roomCode
                );

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Bu oda bulunamadı."
                    });
                }

                return;
            }

            console.log(
                "✅ ODA BULUNDU"
            );

            console.log(
                "MEVCUT OYUNCULAR:",
                room.players.map(
                    p => p.username
                )
            );

            if (room.gameStarted) {

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Oyun zaten başladı."
                    });
                }

                return;
            }

            const nameExists =
                room.players.some(
                    player =>
                        player.username
                            .toLowerCase() ===
                        username.toLowerCase()
                );

            if (nameExists) {

                console.log(
                    "❌ AYNI İSİM:",
                    username
                );

                if (callback) {
                    callback({
                        success: false,
                        message:
                            "Bu kullanıcı adı odada zaten kullanılıyor."
                    });
                }

                return;
            }

            const token =
                createPlayerToken();

            const newPlayer = {

                id:
                    socket.id,

                token:
                    token,

                username:
                    username,

                role:
                    null,

                alive:
                    true
            };

            room.players.push(
                newPlayer
            );

            socket.roomCode =
                roomCode;

            socket.username =
                username;

            socket.playerToken =
                token;

            socket.join(roomCode);

            console.log(
                "================================="
            );

            console.log(
                "✅ OYUNCU BAŞARIYLA EKLENDİ"
            );

            console.log(
                "USERNAME:",
                username
            );

            console.log(
                "ROOM:",
                roomCode
            );

            console.log(
                "OYUNCU SAYISI:",
                room.players.length
            );

            console.log(
                "OYUNCULAR:",
                room.players.map(
                    p => p.username
                )
            );

            console.log(
                "================================="
            );

            // Katılan oyuncuya cevap
            if (callback) {

                callback({
                    success:
                        true,

                    roomCode:
                        roomCode,

                    token:
                        token
                });
            }

            // Odaya yeni listeyi gönder
            sendPlayers(roomCode);
        }
    );

    // ========================================
    // OYUNU BAŞLAT
    // ========================================

    socket.on(
        "startGame",
        () => {

            const roomCode =
                socket.roomCode;

            const room =
                rooms[roomCode];

            if (!room) {
                return;
            }

            if (
                room.host !==
                socket.id
            ) {

                socket.emit(
                    "gameError",
                    "Sadece oda sahibi oyunu başlatabilir."
                );

                return;
            }

            if (
                room.players.length < 3
            ) {

                socket.emit(
                    "gameError",
                    "En az 3 oyuncu gerekli."
                );

                return;
            }

            if (room.gameStarted) {
                return;
            }

            const roles =
                createRoles(
                    room.players.length
                );

            room.players.forEach(
                (player, index) => {

                    player.role =
                        roles[index];

                    player.alive =
                        true;
                }
            );

            room.gameStarted =
                true;

            console.log(
                "OYUN BAŞLADI:",
                roomCode
            );

            room.players.forEach(
                player => {

                    io.to(
                        player.id
                    ).emit(
                        "gameStarted",
                        {
                            username:
                                player.username,

                            role:
                                player.role,

                            roomCode:
                                roomCode
                        }
                    );
                }
            );

            sendPlayers(roomCode);

            room.phaseTimer =
                setTimeout(() => {
                    startNight(roomCode);
                }, 1000);
        }
    );

    // ========================================
    // VAMPİR
    // ========================================

    socket.on(
        "vampireKill",
        targetId => {

            const room =
                rooms[
                    socket.roomCode
                ];

            if (
                !room ||
                room.phase !==
                "night"
            ) {
                return;
            }

            const player =
                room.players.find(
                    p =>
                        p.id ===
                        socket.id
                );

            if (
                !player ||
                !player.alive ||
                player.role !==
                "Vampir"
            ) {
                return;
            }

            const target =
                room.players.find(
                    p =>
                        p.id ===
                        targetId
                );

            if (
                !target ||
                !target.alive ||
                target.id ===
                socket.id
            ) {
                return;
            }

            room.vampireTarget =
                target.id;

            socket.emit(
                "actionConfirmed",
                "Hedef seçildi."
            );
        }
    );

    // ========================================
    // DOKTOR
    // ========================================

    socket.on(
        "doctorSave",
        targetId => {

            const room =
                rooms[
                    socket.roomCode
                ];

            if (
                !room ||
                room.phase !==
                "night"
            ) {
                return;
            }

            const player =
                room.players.find(
                    p =>
                        p.id ===
                        socket.id
                );

            if (
                !player ||
                !player.alive ||
                player.role !==
                "Doktor"
            ) {
                return;
            }

            const target =
                room.players.find(
                    p =>
                        p.id ===
                        targetId
                );

            if (
                !target ||
                !target.alive
            ) {
                return;
            }

            room.doctorTarget =
                target.id;

            socket.emit(
                "actionConfirmed",
                "Oyuncu kurtarma hedefi seçildi."
            );
        }
    );

    // ========================================
    // DEDEKTİF
    // ========================================

    socket.on(
        "detectiveCheck",
        targetId => {

            const room =
                rooms[
                    socket.roomCode
                ];

            if (
                !room ||
                room.phase !==
                "night"
            ) {
                return;
            }

            const player =
                room.players.find(
                    p =>
                        p.id ===
                        socket.id
                );

            if (
                !player ||
                !player.alive ||
                player.role !==
                "Dedektif"
            ) {
                return;
            }

            const target =
                room.players.find(
                    p =>
                        p.id ===
                        targetId
                );

            if (
                !target ||
                !target.alive ||
                target.id ===
                socket.id
            ) {
                return;
            }

            socket.emit(
                "detectiveResult",
                {
                    username:
                        target.username,

                    isVampire:
                        target.role ===
                        "Vampir"
                }
            );
        }
    );

    // ========================================
    // OY
    // ========================================

    socket.on(
        "vote",
        targetId => {

            const room =
                rooms[
                    socket.roomCode
                ];

            if (
                !room ||
                room.phase !==
                "voting"
            ) {
                return;
            }

            const voter =
                room.players.find(
                    p =>
                        p.id ===
                        socket.id
                );

            if (
                !voter ||
                !voter.alive
            ) {
                return;
            }

            const target =
                room.players.find(
                    p =>
                        p.id ===
                        targetId
                );

            if (
                !target ||
                !target.alive ||
                target.id ===
                socket.id
            ) {
                return;
            }

            room.votes[
                socket.id
            ] = target.id;

            socket.emit(
                "actionConfirmed",
                "Oyun kaydedildi."
            );
        }
    );

    // ========================================
    // CHAT
    // ========================================

    socket.on(
        "chatMessage",
        message => {

            const room =
                rooms[
                    socket.roomCode
                ];

            if (!room) {
                return;
            }

            const player =
                room.players.find(
                    p =>
                        p.id ===
                        socket.id
                );

            if (
                !player ||
                !player.alive
            ) {
                return;
            }

            message =
                String(message)
                    .trim();

            if (!message) {
                return;
            }

            if (
                message.length > 300
            ) {
                message =
                    message.substring(
                        0,
                        300
                    );
            }

            io.to(
                socket.roomCode
            ).emit(
                "chatMessage",
                {
                    username:
                        player.username,

                    message:
                        message
                }
            );
        }
    );

    // ========================================
    // DISCONNECT
    // ========================================

    socket.on(
        "disconnect",
        () => {

            console.log(
                "BAĞLANTI KOPTU:",
                socket.id,
                socket.username
            );

            const roomCode =
                socket.roomCode;

            if (
                !roomCode ||
                !rooms[roomCode]
            ) {
                return;
            }

            const room =
                rooms[roomCode];

            // Oyun başlamadıysa oyuncuyu çıkar
            if (!room.gameStarted) {

                room.players =
                    room.players.filter(
                        p =>
                            p.id !==
                            socket.id
                    );

                // Host çıktıysa yeni host
                if (
                    room.host ===
                    socket.id
                ) {

                    if (
                        room.players.length >
                        0
                    ) {

                        room.host =
                            room.players[0].id;

                        io.to(
                            room.host
                        ).emit(
                            "newHost"
                        );
                    }
                }

                sendPlayers(roomCode);

                // Oda boşsa sil
                if (
                    room.players.length ===
                    0
                ) {

                    if (
                        room.phaseTimer
                    ) {
                        clearTimeout(
                            room.phaseTimer
                        );
                    }

                    delete rooms[
                        roomCode
                    ];

                    console.log(
                        "ODA SİLİNDİ:",
                        roomCode
                    );
                }
            }

            // Oyun başladıysa oyuncu
            // odadan silinmez.
        }
    );
});


// ============================================
// SERVER (RENDER UYUMLU)
// ============================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("=================================");
    console.log("SERVER ÇALIŞIYOR");
    console.log("Port:", PORT);
    console.log("=================================");
});

