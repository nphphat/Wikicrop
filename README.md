# WIKICROP - Hệ thống Wiki Nông Nghiệp
**Wikicrop** là hệ thống quản lý tri thức nông nghiệp được xây dựng trên nền tảng MediaWiki, tích hợp các công nghệ Nông nghiệp 4.0.

## Hướng dẫn Cài đặt (Installation Guide)
Do cấu hình bảo mật, file cấu hình gốc không được đưa lên GitHub. Vui lòng làm theo các bước sau để chạy dự án trên máy của bạn (Môi trường khuyến nghị: **XAMPP** trên Windows).

### Bước 1: Tải mã nguồn (Clone Source)
Mở **Terminal** (hoặc PowerShell) tại thư mục `C:\xampp\htdocs\` và chạy lệnh:

```bash
# 1. Clone dự án về máy
git clone https://github.com/nphphat/Wikicrop.git

# 2. Truy cập vào thư mục dự án
cd wikicrop 
```

### Bước 2: Cài đặt thư viện (QUAN TRỌNG)
> Dự án không lưu thư mục vendor trên Git để giảm dung lượng. Bạn bắt buộc phải chạy lệnh sau để tải các thư viện cần thiết:
```bash
composer install --no-dev
```

### Bước 3: Thiết lập Cấu hình (Configuration)
> Hệ thống sử dụng file mẫu để bảo mật mật khẩu. Bạn cần tạo file cấu hình chính thức từ file mẫu này.
```bash
copy LocalSettings.sample.php LocalSettings.php
```

Sau đó, mở file LocalSettings.php bằng VS Code hoặc Notepad và sửa các dòng sau:
- `YOUR_CLARITY_ID` nếu dùng Clarity
- `YOUR_CLARITY_SECRET` nếu dùng Clarity
- `YOUR_CLIENT_ID` nếu dùng Keycloak, tạo client mới trong keycloak sẽ có client id
- `YOUR_KEYCLOAK_CLIENT_SECRET` Xem chi tiết trong file: Cai dat MediaWiki va tich hop Keycloak (1).pdf, client mới sẽ có client secret
- `YOUR_GOOGLE_APP_PASSWORD` Xem chi tiết trong file: Cai dat MediaWiki va tich hop Keycloak (1).pdf.

### Bước 4: Khởi tạo Cơ sở dữ liệu (Database)
> Xem chi tiết trong file: Cai dat MediaWiki va tich hop Keycloak (1).pdf
Lưu ý: Tạo db là mediawiki_new1, user là root, password là rỗng (Không có password) để khớp với LocalSettings.php
### Bước 5: Kiểm tra
> Mở trình duyệt và truy cập: http://localhost/wikicrop/index.php/Main_Page

-------------------------------------------------------------------------------
# MediaWiki

MediaWiki is a free and open-source wiki software package written in PHP. It
serves as the platform for Wikipedia and the other Wikimedia projects, used
by hundreds of millions of people each month. MediaWiki is localised in over
350 languages and its reliability and robust feature set have earned it a large
and vibrant community of third-party users and developers.

MediaWiki is:

* feature-rich and extensible, both on-wiki and with hundreds of extensions;
* scalable and suitable for both small and large sites;
* simple to install, working on most hardware/software combinations; and
* available in your language.

For system requirements, installation, and upgrade details, see the files
RELEASE-NOTES, INSTALL, and UPGRADE.

* Ready to get started?
  * https://www.mediawiki.org/wiki/Special:MyLanguage/Download
* Setting up your local development environment?
  * https://www.mediawiki.org/wiki/Local_development_quickstart
* Looking for the technical manual?
  * https://www.mediawiki.org/wiki/Special:MyLanguage/Manual:Contents
* Seeking help from a person?
  * https://www.mediawiki.org/wiki/Special:MyLanguage/Communication
* Looking to file a bug report or a feature request?
  * https://bugs.mediawiki.org/
* Interested in helping out?
  * https://www.mediawiki.org/wiki/Special:MyLanguage/How_to_contribute

MediaWiki is the result of global collaboration and cooperation. The CREDITS
file lists technical contributors to the project. The COPYING file explains
MediaWiki's copyright and license (GNU General Public License, version 2 or
later). Many thanks to the Wikimedia community for testing and suggestions.


