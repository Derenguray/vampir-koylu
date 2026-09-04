const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};


// ======================================
// ROLLER
// ======================================

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

        [roles[i], roles[j]] =
            [roles[j], roles[i]];
    }

    return roles;
}


// ======================================
// YAŞAYAN OYUNCULAR
// ======================================

function getAlivePlayers(room) {

    return room.players.filter(
        player => player.alive
    );
}


// ======================================
// OYUNCU LİSTESİ
// ======================================

function sendPlayers(roomCode) {

    const room = rooms[roomCode];

    if (!room) {
        return;
    }

    io.to(roomCode).emit(
        "gamePlayers",
        room.players.map(player => ({
            id: player.id,
            username: player.username,
            alive: player.alive
        }))
    );
}


// ======================================
// KAZANMA KONTROLÜ
// ======================================

function checkWin(roomCode) {

    const room = rooms[roomCode];

    if (!room) {
        return true;
    }

    const alive =
        getAlivePlayers(room);

    const vampires =
        alive.filter(
            player => player.role === "Vampir"
        );

    const villagers =
        alive.filter(
            player => player.role !== "Vampir"
        );


    // Vampir kalmadı
    if (vampires.length === 0) {

        room.gameStarted = false;
        room.phase = "gameover";

        io.to(roomCode).emit(
            "gameOver",
            {
                winner: "Köylüler"
            }
        );

        return true;
    }


    // Vampirler sayı olarak eşit veya fazla
    if (vampires.length >= villagers.length) {

        room.gameStarted = false;
        room.phase = "gameover";

        io.to(roomCode).emit(
            "gameOver",
            {
                winner: "Vampirler"
            }
        );

        return true;
    }


    return false;
}


// ======================================
// OYUNCUYA MEVCUT OYUN DURUMUNU GÖNDER
// ======================================

function sendGameState(socket) {

    const roomCode =
        socket.roomCode;

    const room =
        rooms[roomCode];

    if (!room) {
        return;
    }


    const player =
        room.players.find(
            p => p.id === socket.id
        );


    if (!player) {
        return;
    }


    // Oyuncunun rolü
    socket.emit(
        "gameStarted",
        {
            username: player.username,
            role: player.role,
            roomCode: roomCode
        }
    );


    // Oyuncular
    socket.emit(
        "gamePlayers",
        room.players.map(p => ({
            id: p.id,
            username: p.username,
            alive: p.alive
        }))
    );


    // Mevcut faz
    if (room.phase !== "lobby") {

        socket.emit(
            "phaseChanged",
            {
                phase: room.phase,
                duration: room.phaseDuration,
                endTime: room.phaseEndTime
            }
        );
    }


    // Eğer şu an geceyse yeteneği tekrar gönder
    if (
        room.phase === "night" &&
        player.alive
    ) {

        socket.emit(
            "nightStarted",
            {
                role: player.role
            }
        );
    }

    // Eğer oylamadaysa oy verme ekranını tekrar gönder
    if (
        room.phase === "voting" &&
        player.alive
    ) {

        socket.emit(
            "votingStarted"
        );
    }
}


// ======================================
// FAZ BAŞLAT
// ======================================

function setPhase(
    roomCode,
    phase,
    duration
) {

    const room =
        rooms[roomCode];

    if (!room) {
        return;
    }


    // Önceki timer
    if (room.phaseTimer) {

        clearTimeout(
            room.phaseTimer
        );

    }


    room.phase =
        phase;

    room.phaseDuration =
        duration;

    room.phaseEndTime =
        Date.now() +
        duration * 1000;


    io.to(roomCode).emit(
        "phaseChanged",
        {
            phase: phase,
            duration: duration,
            endTime: room.phaseEndTime
        }
    );
}


// ======================================
// GECE
// ======================================

function startNight(roomCode) {

    const room =
        rooms[roomCode];

    if (!room || !room.gameStarted) {
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


    // Rollere göre gece yeteneklerini göster
    room.players.forEach(
        player => {

            if (!player.alive) {
                return;
            }


            io.to(player.id).emit(
                "nightStarted",
                {
                    role: player.role
                }
            );

        }
    );


    room.phaseTimer =
        setTimeout(
            () => {

                finishNight(
                    roomCode
                );

            },
            30000
        );
}


// ======================================
// GECEYİ BİTİR
// ======================================

function finishNight(roomCode) {

    const room =
        rooms[roomCode];

    if (!room || !room.gameStarted) {
        return;
    }


    let killedPlayer = null;


    // Vampir hedef seçmişse
    if (room.vampireTarget) {

        const target =
            room.players.find(
                p =>
                    p.id ===
                    room.vampireTarget
            );


        if (
            target &&
            target.alive
        ) {

            // Doktor kurtarmadıysa öldür
            if (
                room.doctorTarget !==
                target.id
            ) {

                target.alive =
                    false;

                killedPlayer =
                    target;

            }

        }

    }


    // Gece sonucu
    if (killedPlayer) {

        io.to(roomCode).emit(
            "nightResult",
            {
                killed:
                    killedPlayer.username
            }
        );

    }
    else {

        io.to(roomCode).emit(
            "nightResult",
            {
                killed: null
            }
        );

    }


    sendPlayers(roomCode);


    // Kazanan var mı?
    if (
        checkWin(roomCode)
    ) {

        return;

    }


    // 4 saniye sonra gündüz
    room.phaseTimer =
        setTimeout(
            () => {

                startDiscussion(
                    roomCode
                );

            },
            4000
        );
}


// ======================================
// GÜNDÜZ / TARTIŞMA
// ======================================

function startDiscussion(roomCode) {

    const room =
        rooms[roomCode];

    if (!room || !room.gameStarted) {
        return;
    }


    setPhase(
        roomCode,
        "discussion",
        30
    );


    room.phaseTimer =
        setTimeout(
            () => {

                startVoting(
                    roomCode
                );

            },
            30000
        );
}


// ======================================
// OYLAMA
// ======================================

function startVoting(roomCode) {

    const room =
        rooms[roomCode];

    if (!room || !room.gameStarted) {
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


    room.phaseTimer =
        setTimeout(
            () => {

                finishVoting(
                    roomCode
                );

            },
            20000
        );
}


// ======================================
// OYLARI SAY
// ======================================

function finishVoting(roomCode) {

    const room =
        rooms[roomCode];

    if (!room || !room.gameStarted) {
        return;
    }


    const voteCounts = {};


    Object.values(
        room.votes
    ).forEach(
        targetId => {

            if (
                !voteCounts[targetId]
            ) {

                voteCounts[targetId] =
                    0;

            }

            voteCounts[targetId]++;

        }
    );


    let highestVotes = 0;
    let candidates = [];


    Object.entries(
        voteCounts
    ).forEach(
        ([id, votes]) => {

            if (
                votes >
                highestVotes
            ) {

                highestVotes =
                    votes;

                candidates =
                    [id];

            }

            else if (
                votes ===
                highestVotes
            ) {

                candidates.push(id);

            }

        }
    );


    // Kimse oy vermediyse
    if (
        candidates.length === 0
    ) {

        io.to(roomCode).emit(
            "executionResult",
            {
                executed: null,
                message:
                    "Kimse oy vermedi."
            }
        );


        room.phaseTimer =
            setTimeout(
                () => {

                    startNight(
                        roomCode
                    );

                },
                4000
            );

        return;
    }


    // Eşitlik
    if (
        candidates.length > 1
    ) {

        io.to(roomCode).emit(
            "executionResult",
            {
                executed: null,
                message:
                    "Oylar eşit! Kimse asılmadı."
            }
        );


        room.phaseTimer =
            setTimeout(
                () => {

                    startNight(
                        roomCode
                    );

                },
                4000
            );

        return;
    }


    // Asılacak oyuncu
    const executedPlayer =
        room.players.find(
            player =>
                player.id ===
                candidates[0]
        );


    if (executedPlayer) {

        executedPlayer.alive =
            false;


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


    // Kazanma kontrolü
    if (
        checkWin(roomCode)
    ) {

        return;

    }


    // 5 saniye sonra gece
    room.phaseTimer =
        setTimeout(
            () => {

                startNight(
                    roomCode
                );

            },
            5000
        );
}


// ======================================
// SOCKET
// ======================================

io.on(
    "connection",
    socket => {

        console.log(
            "Bağlandı:",
            socket.id
        );


        // ==================================
        // GAME.HTML AÇILDIĞINDA
        // ==================================

        socket.on(
            "requestGameState",
            () => {

                sendGameState(
                    socket
                );

            }
        );


        // ==================================
        // ODA OLUŞTUR
        // ==================================

        socket.on(
            "createRoom",
            username => {

                let roomCode;


                do {

                    roomCode =
                        Math.random()
                            .toString(36)
                            .substring(
                                2,
                                8
                            )
                            .toUpperCase();

                }
                while (
                    rooms[roomCode]
                );


                rooms[roomCode] = {

                    host:
                        socket.id,

                    players: [],

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

                    votes: {},

                    vampireTarget:
                        null,

                    doctorTarget:
                        null,

                    detectiveTarget:
                        null
                };


                rooms[
                    roomCode
                ].players.push({

                    id:
                        socket.id,

                    username:
                        username,

                    role:
                        null,

                    alive:
                        true
                });


                socket.join(
                    roomCode
                );

                socket.roomCode =
                    roomCode;

                socket.username =
                    username;


                socket.emit(
                    "roomCreated",
                    roomCode
                );


                sendPlayers(
                    roomCode
                );

            }
        );


        // ==================================
        // ODAYA KATIL
        // ==================================

        socket.on(
            "joinRoom",
            ({ username, roomCode }) => {

                roomCode =
                    roomCode
                        .toUpperCase();


                const room =
                    rooms[roomCode];


                if (!room) {

                    socket.emit(
                        "roomError",
                        "Bu oda bulunamadı."
                    );

                    return;
                }


                if (
                    room.gameStarted
                ) {

                    socket.emit(
                        "roomError",
                        "Oyun zaten başladı."
                    );

                    return;
                }


                room.players.push({

                    id:
                        socket.id,

                    username:
                        username,

                    role:
                        null,

                    alive:
                        true

                });


                socket.join(
                    roomCode
                );

                socket.roomCode =
                    roomCode;

                socket.username =
                    username;


                socket.emit(
                    "joinedRoom",
                    roomCode
                );


                sendPlayers(
                    roomCode
                );

            }
        );


        // ==================================
        // OYUNU BAŞLAT
        // ==================================

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

                    return;

                }


                if (
                    room.players.length <
                    3
                ) {

                    socket.emit(
                        "gameError",
                        "En az 3 oyuncu gerekli."
                    );

                    return;
                }


                if (
                    room.gameStarted
                ) {

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


                // Rolleri oyunculara gönder
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


                sendPlayers(
                    roomCode
                );


                // 1 saniye sonra gece
                room.phaseTimer =
                    setTimeout(
                        () => {

                            startNight(
                                roomCode
                            );

                        },
                        1000
                    );

            }
        );


        // ==================================
        // VAMPİR ÖLDÜRME
        // ==================================

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
                    targetId;


                socket.emit(
                    "actionConfirmed",
                    "🩸 Hedef seçildi."
                );

            }
        );


        // ==================================
        // DOKTOR
        // ==================================

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
                    targetId;


                socket.emit(
                    "actionConfirmed",
                    "🩺 Kurtarma hedefi seçildi."
                );

            }
        );


        // ==================================
        // DEDEKTİF
        // ==================================

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


                if (!target) {
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


        // ==================================
        // OY VER
        // ==================================

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
                ] =
                    targetId;


                socket.emit(
                    "actionConfirmed",
                    "🗳️ Oyun kaydedildi."
                );

            }
        );


        // ==================================
        // CHAT
        // ==================================

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


        // ==================================
        // DISCONNECT
        // ==================================

        socket.on(
            "disconnect",
            () => {

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


                room.players =
                    room.players.filter(
                        p =>
                            p.id !==
                            socket.id
                    );


                // Host ayrılırsa yeni host
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

                    }

                }


                sendPlayers(
                    roomCode
                );


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

                }

            }
        );

    }
);


server.listen(
    3000,
    () => {

        console.log(
            "Server çalışıyor: http://localhost:3000"
        );

    }
);