(function () {
    // Sử dụng $(function() {}) để đảm bảo code chạy ngay khi script được tải xong
    $(function () {
        var toggler = document.getElementById("chatbot-toggler");
        var container = document.getElementById("chatbot-container");
        var closeBtn = document.getElementById("close-chat");
        var sendBtn = document.getElementById("send-btn");
        var input = document.getElementById("chat-input");
        var messages = document.getElementById("chat-messages");

        // Hàm bật tắt khung chat
        function toggleChat() {
            if (!container) return;
            if (container.style.display === "none" || container.style.display === "") {
                container.style.display = "flex";
                // Focus vào ô nhập liệu ngay khi mở
                if(input) input.focus();
            } else {
                container.style.display = "none";
            }
        }

        // Gán sự kiện click (kiểm tra kỹ null để tránh lỗi)
        if (toggler) {
            toggler.addEventListener("click", function(e) {
                e.preventDefault(); // Ngăn chặn hành vi mặc định nếu có
                toggleChat();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener("click", toggleChat);
        }

        // --- Phần logic gửi tin nhắn giữ nguyên ---
        function sendMessage() {
            var text = input.value.trim();
            if (!text) return;

            // 1. Hiện tin nhắn User
            var userDiv = document.createElement("div");
            userDiv.className = "user-msg";
            userDiv.textContent = text;
            messages.appendChild(userDiv);
            input.value = "";
            messages.scrollTop = messages.scrollHeight;

            // 2. Hiệu ứng đang nhập
            var loadingDiv = document.createElement("div");
            loadingDiv.className = "bot-msg";
            loadingDiv.style.fontStyle = "italic";
            loadingDiv.textContent = "Đang suy nghĩ...";
            loadingDiv.id = "loading-msg";
            messages.appendChild(loadingDiv);
            messages.scrollTop = messages.scrollHeight;

            // 3. Gọi API
            var apiUrl = mw.config.get("WikiChatbotApiUrl") || "http://localhost:8000/ask";
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: text })
            })
            .then(response => response.json())
            .then(data => {
                var loadMsg = document.getElementById("loading-msg");
                if(loadMsg) loadMsg.remove();

                var botDiv = document.createElement("div");
                botDiv.className = "bot-msg";
                // Xử lý xuống dòng nếu có
                botDiv.innerHTML = data.answer ? data.answer.replace(/\n/g, "<br>") : "Không có phản hồi.";
                messages.appendChild(botDiv);
                messages.scrollTop = messages.scrollHeight;
            })
            .catch(error => {
                var loadMsg = document.getElementById("loading-msg");
                if(loadMsg) loadMsg.remove();
                
                var errDiv = document.createElement("div");
                errDiv.className = "bot-msg";
                errDiv.style.background = "#ffcccc";
                errDiv.textContent = "Chưa bật Server Python hoặc lỗi kết nối!";
                messages.appendChild(errDiv);
            });
        }

        if (sendBtn) sendBtn.addEventListener("click", sendMessage);
        if (input) {
            input.addEventListener("keypress", function(e) {
                if (e.key === "Enter") sendMessage();
            });
        }
    });
}());