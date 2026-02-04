import sys
import json
import argparse
import os
import io
from app import extract_video_id, get_video_title, get_transcript_text, summarize_text

# Cấu hình API Key Default (giống app.py)
DEFAULT_API_KEY = "AIzaSyAOxPM5hG1t0A3U-5yreo7Z9R5qLS9XCDo"

def main():
    parser = argparse.ArgumentParser(description="YouTube API Helper for QuanLyNongNghiep")
    parser.add_argument("--action", required=True, choices=["info", "summarize"], help="Action to perform")
    parser.add_argument("--url", required=True, help="YouTube Video URL")
    parser.add_argument("--api_key", default=DEFAULT_API_KEY, help="Gemini API Key")
    parser.add_argument("--model", default="gemini-flash-latest", help="Gemini Model")

    args = parser.parse_args()
    
    # Capture original stdout/stderr to disable them
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = io.StringIO()
    sys.stderr = io.StringIO()

    result = {"success": False, "data": None, "error": None}

    try:
        if args.action == "info":
            video_id = extract_video_id(args.url)
            if video_id:
                title = get_video_title(args.url)
                result["success"] = True
                result["data"] = {"title": title, "video_id": video_id}
            else:
                result["error"] = "Invalid YouTube URL"

        elif args.action == "summarize":
            video_id = extract_video_id(args.url)
            if video_id:
                transcript, error = get_transcript_text(video_id)
                if transcript:
                    summary = summarize_text(args.api_key, transcript, args.model)
                    result["success"] = True
                    result["data"] = {"summary": summary}
                else:
                     result["error"] = f"Transcript error: {error}"
            else:
                result["error"] = "Invalid YouTube URL"
                
    except Exception as e:
        result["error"] = str(e)
    
    # Restore stdout for final JSON printing
    sys.stdout = original_stdout
    sys.stderr = original_stderr
    
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
