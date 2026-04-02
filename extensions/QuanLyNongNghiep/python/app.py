import streamlit as st
from youtube_transcript_api import YouTubeTranscriptApi
from urllib.parse import urlparse, parse_qs
import requests
from google import genai

# Hàm lấy tiêu đề video từ oEmbed
def get_video_title(video_url):
    try:
        oembed_url = f"https://www.youtube.com/oembed?url={video_url}&format=json"
        response = requests.get(oembed_url)
        if response.status_code == 200:
            data = response.json()
            return data.get('title', 'Không thể lấy tiêu đề')
        return "Không thể lấy tiêu đề (Lỗi mạng)"
    except Exception:
        return "Không thể lấy tiêu đề (Lỗi ngoại lệ)"

# Hàm trích xuất Video ID từ URL
def extract_video_id(url):
    query = urlparse(url)
    if query.hostname == 'youtu.be':
        return query.path[1:]
    if query.hostname in ('www.youtube.com', 'youtube.com'):
        if query.path == '/watch':
            p = parse_qs(query.query)
            return p['v'][0]
        if query.path[:7] == '/embed/':
            return query.path.split('/')[2]
        if query.path[:3] == '/v/':
            return query.path.split('/')[2]
    return None

# Hàm lấy transcript
def get_transcript_text(video_id):
    try:
        yt_api = YouTubeTranscriptApi()
        
        # Lấy danh sách transcript
        transcript_list_obj = yt_api.list(video_id)
        
        transcript = None
        
        # 1. Ưu tiên tìm tiếng Việt hoặc Anh
        try:
            transcript = transcript_list_obj.find_transcript(['vi', 'en'])
        except:
            # 2. Nếu không có, lấy transcript đầu tiên tìm thấy (bất kể ngôn ngữ, ưu tiên manual -> generated)
            try:
                transcript = next(iter(transcript_list_obj))
            except StopIteration:
                return None, "Video không có phụ đề (No transcripts found)"
        
        # 3. Fetch nội dung
        if transcript:
            fetched_transcript = transcript.fetch()
            full_text = " ".join([item.text for item in fetched_transcript])
            return full_text, None
            
        return None, "Không tìm thấy transcript phù hợp"

    except Exception as e:
        return None, str(e)

# Hàm tóm tắt với Gemini
def summarize_text(api_key, text, model_name='gemini-flash-latest'):
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=f"Hãy tóm tắt nội dung sau đây bằng tiếng Việt một cách chi tiết và súc tích đồng thời không bỏ bớt ý nghĩa của video (Tóm tắt khoảng 100-150 từ, không cần viết số từ ở cuối):\n\n{text}"
        )
        return response.text
    except Exception as e:
        return f"Lỗi khi tóm tắt: {str(e)}"
# ... (functions remain same)

if __name__ == "__main__":
    st.set_page_config(page_title="YouTube Transcript Getter", page_icon="📺")

    st.title("Lấy nội dung Video YouTube")
    st.markdown("Nhập đường dẫn video YouTube để lấy toàn bộ văn bản (transcript).")

    # Input URL
    url_input = st.text_input("Dán link YouTube tại đây:", placeholder="https://www.youtube.com/watch?v=...")

    if st.button("Lấy nội dung", type="primary"):
        if url_input:
            with st.spinner("Đang xử lý..."):
                video_id = extract_video_id(url_input)
                
                if video_id:
                    # Lấy tiêu đề trước
                    video_title = get_video_title(url_input)
                    
                    transcript_text, error = get_transcript_text(video_id)
                    
                    if transcript_text:
                        st.session_state['transcript_text'] = transcript_text
                        st.session_state['video_id'] = video_id
                        st.session_state['video_title'] = video_title
                        st.session_state['error'] = None
                    else:
                        st.session_state['transcript_text'] = None
                        st.session_state['error'] = error
                else:
                    st.error("Link YouTube không hợp lệ. Vui lòng kiểm tra lại.")
        else:
            st.warning("Vui lòng nhập đường dẫn video.")

    # Hiển thị nội dung nếu có trong session state
    if 'transcript_text' in st.session_state and st.session_state['transcript_text']:
        video_id = st.session_state['video_id']
        transcript_text = st.session_state['transcript_text']
        video_title = st.session_state.get('video_title', 'Video YouTube')
        
        st.success("Đã lấy nội dung thành công!")
        st.subheader(video_title)
        st.text_area("Nội dung video:", value=transcript_text, height=300)
        
        st.download_button(
            label="Tải xuống (.txt)",
            data=transcript_text,
            file_name=f"transcript_{video_id}.txt",
            mime="text/plain"
        )

        st.markdown("---")
        st.header("Tóm tắt bằng Gemini")
        
        # Chọn Model
        model_options = ["gemini-2.0-flash", "gemini-2.0-flash-lite-001", "gemini-flash-latest"]
        selected_model = st.selectbox("Chọn Model:", model_options, index=0)
        
        # Cấu hình API Key
        # API Key removed for security. Please input manually or set via environment variable.
        DEFAULT_API_KEY = "" 
        
        api_key_input = st.text_input("Nhập Gemini API Key:", type="password", help="Nhập API Key của bạn để sử dụng tính năng tóm tắt.")
        
        api_key = api_key_input
        if not api_key:
            api_key = DEFAULT_API_KEY

        if st.button("Tóm tắt nội dung"):
            if not api_key:
                st.warning("Vui lòng nhập Gemini API Key để tiếp tục.")
            else:
                with st.spinner(f"Gemini ({selected_model}) đang đọc và tóm tắt..."):
                    summary_text = summarize_text(api_key, transcript_text, selected_model)
                    st.success("Đã tóm tắt xong!")
                    st.markdown("Bản tóm tắt:")
                    st.write(summary_text)

    elif 'error' in st.session_state and st.session_state['error']:
        st.error(f"Không thể lấy transcript. Lỗi: {st.session_state['error']}")
        st.info("Lưu ý: Video phải có phụ đề (CC) thì mới lấy được nội dung.")