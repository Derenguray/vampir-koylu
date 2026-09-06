const socket = io();

// ===============================
// ELEMENTLER
// ===============================
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

const usernameInput = document.getElementById("usernameInput");
const joinUsernameInput = document.getElementById("joinUsernameInput");
const joinRoomCodeInput = document.getElementById("joinRoomCodeInput");

const lobbyDiv = document.getElementById("lobby");
const roomCodeText = document.getElementById("roomCodeText");
const playerListDiv = document.getElementById("playerList");
const playerCountText = document.getElementById("playerCountText");

const startGameBtn = document.getElementById("startGameBtn");

// ===============================
// ODA OLUŞTUR
// ===============================
createRoomBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();

    if (!username) {
        alert("Kullanıcı adı gerekli.");
        return;
    }

    socket.emit("createRoom", username);
});

// Sunucudan oda bilgisi geldi
socket.on("roomCreated", data => {
    // data = { roomCode, token }
    roomCodeText.innerText = data.roomCode;
    localStorage.setItem("token", data.token);
    localStorage.setItem("roomCode", data.roomCode);

    lobbyDiv.style.display = "block";
});

// ===============================
// ODAYA KATIL
// ===============================
joinRoomBtn.addEventListener("click", () => {
    const username = joinUsernameInput.value.trim();
    const roomCode = joinRoomCodeInput.value.trim().toUpperCase();

    if (!username || !roomCode) {
        alert("Bilgiler eksik.");
        return;
    }

    socket.emit("joinRoom", { username, roomCode }, response => {
        if (!response.success) {
            alert(response.message);
            return;
        }

        localStorage.setItem("token", response.token);
        localStorage.setItem("roomCode", response.roomCode);

        roomCodeText.innerText = response.roomCode;
        lobbyDiv.style.display = "block";
    });
});

// ===============================
// OYUNCU LİSTESİ
// ===============================
socket.on("gamePlayers", players => {
    playerListDiv.innerHTML = "";

    players.forEach(p => {
        const item = document.createElement("div");
        item.innerText = `${p.username} ${p.alive ? "" : "(Ölü)"}`;
        playerListDiv.appendChild(item);
    });

    playerCountText.innerText = players.length;
});

// ===============================
// OYUNU BAŞLAT
// ===============================
startGameBtn.addEventListener("click", () => {
    socket.emit("startGame");
});

// ===============================
// OYUN BAŞLADI
// ===============================
socket.on("gameStarted", data => {
    alert(`Rolün: ${data.role}`);
});

// ===============================
// FAZ DEĞİŞİMİ
// ===============================
socket.on("phaseChanged", data => {
    console.log("Yeni faz:", data.phase);
});
