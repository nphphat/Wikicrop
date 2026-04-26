# QuanLyNongNghiep40

Extension dành cho MediaWiki để quản lý danh sách các trang web / video YouTube về Nông nghiệp 4.0, có tính năng tóm tắt tự động nội dung video YouTube bằng AI (Mô hình Gemini).

## Yêu cầu hệ thống
* MediaWiki >= 1.35
* Python >= 3.8

## Hướng dẫn cài đặt

**1. Tải Extension**
Clone (hoặc tải mã nguồn) extension này vào thư mục `extensions/` của cấu trúc thư mục MediaWiki:
```bash
cd extensions/
git clone https://github.com/nphphat/extension-QuanLyNongNghiep40.git QuanLyNongNghiep40
```

**2. Cài đặt môi trường ảo Python (Virtual Environment)**
Vì thư mục `venv` chứa các thư viện Python KHÔNG được tải lên Github (do quá trình xử lý nặng và khác biệt trên mỗi hệ điều hành), bạn cần khởi tạo lại môi trường Python để chạy tính năng AI:

***Trên Windows:***
```bash
cd QuanLyNongNghiep40
python -m venv venv
venv\Scripts\activate
pip install -r python/requirements.txt
```

***Trên macOS / Linux:***
```bash
cd QuanLyNongNghiep40
python3 -m venv venv
source venv/bin/activate
pip install -r python/requirements.txt
```

**3. Kích hoạt Extension trong MediaWiki**
Mở file `LocalSettings.php` ở thư mục gốc MediaWiki của bạn và thêm vào cuối các dòng lệnh sau:

```php
// Tải extension
wfLoadExtension( 'QuanLyNongNghiep40' );

// Cấp quyền API Key cho Gemini (Thay thế bằng Key của bạn)
$wgQuanLyNongNghiep40GeminiKey = 'YOUR_GEMINI_API_KEY';
```

**4. Cập nhật Cơ sở dữ liệu (Database)**
Chạy script update của MediaWiki để tạo bảng lưu trữ dữ liệu `nongnghiep40_resources` vào SQL:
Mở terminal từ **thư mục gốc của MediaWiki** và chạy:
```bash
php maintenance/update.php
```

## Sử dụng
Truy cập đường dẫn **Special:QuanLyNongNghiep40** (hoặc Trang đặc biệt: QuanLyNongNghiep40) trên hệ thống Wiki của bạn để bắt đầu sử dụng. Lấy đường link Youtube cần xem và "Tóm tắt"!
