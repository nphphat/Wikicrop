# Hướng Dẫn Sử Dụng Extension "PlantMorphology"

Extension **PlantMorphology** giúp lấy dữ liệu hình thái từ API EforaVN và chèn vào bài viết MediaWiki dưới dạng Wikitext.

## 1. Cài đặt

1. (Bỏ qua) Copy thư mục `PlantMorphology` vào thư mục `extensions/` của dự án Wikicrop. Đảm bảo cấu trúc file như sau:
   ```text
   Wikicrop/extensions/PlantMorphology/
   ├── extension.json
   ├── PlantMorphology.i18n.magic.php
   └── src/Hook.php
   ```
2. Mở file `LocalSettings.php` và thêm dòng sau vào cuối:
   ```php
   wfLoadExtension( 'PlantMorphology' );
   ```
3. Lưu file. Extension đã sẵn sàng hoạt động (không cần chạy thêm lệnh `php maintenance/update.php` hay `composer install`).

## 2. Sử dụng

Chèn cú pháp sau vào vị trí bất kỳ trong mã nguồn bài viết:
```wikitext
{{#morphology:ID_CỦA_CÂY}}
```

**Ví dụ:** Để hiển thị hình thái cây Lúa, gõ đoạn mã sau vào post của Lía:
```wikitext
{{#morphology:2703459}}
```

## 3. Hướng dẫn lấy ID cây

1. Truy cập API tra cứu: [https://efloravn.vercel.app/](https://efloravn.vercel.app/)
2. Tìm kiếm theo **Tên khoa học** (VD: *Oryza sativa*) hoặc **Tên Tiếng Việt** (VD: *Lúa*).
3. Truy cập vào trang chi tiết của cây tương ứng.
4. Lấy con số **ID của loài** được hiển thị trên giao diện và gắn vào cú pháp (Ví dụ: `2703459`).