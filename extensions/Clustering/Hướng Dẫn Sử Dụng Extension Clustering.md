# HƯỚNG DẪN SỬ DỤNG EXTENSION "CLUSTERING"

Extension **Clustering** tích hợp phân hệ phân tích gom cụm học máy (K-Means, Hierarchical, CLARA, EM) trực quan hóa tương tác động trực tiếp trên nền tảng quản trị tri thức WikiCrop.

## 1. Cài đặt

### Bước 1.1: Tổ chức thư mục dự án

Đảm bảo bạn đã đổi tên thư mục gốc của Extension thành Clustering và đặt vào thư mục extensions/ của WikiCrop. Cấu trúc tệp tin bắt buộc phải như sau:

Wikicrop/extensions/Clustering/  
├── extension.json                    
├── includes/  
│   ├── Hooks.php                    
│   └── SpecialClustering.php         
├── i18n/  
│   ├── en.json                      
│   └── vi.json                     
├── modules/  
│   ├── ext.clustering.css            
│   └── ext.clustering.js          

### Bước 1.2: Kích hoạt Extension

1. Mở file LocalSettings.php và thêm dòng sau vào cuối wfLoadExtension( 'Clustering' );

2. Lưu file. Extension đã sẵn sàng hoạt động mà không cần chạy thêm lệnh `php maintenance/update.php` hay `composer install`.

## 2.Cách truy cập 

Sau khi kích hoạt thành công, bạn có thể truy cập extension thông qua hai cách:

1. **Cách 1 (Menu tự động):** Truy cập Menu chính ở thanh điều hướng bên trái (Sidebar), nhấn chọn mục **"Gom cụm dữ liệu"**.  
2. **Cách 2 (Đường dẫn trực tiếp):** Nhập trực tiếp đường dẫn đặc biệt sau vào thanh địa chỉ trình duyệt:  
   http://localhost/wikicrop/index.php/Special:Clustering

## 3.Các bước tiến hành gom cụm

Người dùng cần thực hiện các bước như sau:

### Bước 1: Nạp dữ liệu (Data Loader)

1. Nhấp chọn nút **Choose File** ở giữa màn hình.  
2. Tải lên tệp dữ liệu thực địa của bạn định dạng Excel (.xlsx, .xls) hoặc .csv 
3. Hệ thống sẽ tự động quét lỗi, hiển thị thống kê tổng quan (số mẫu giống, số thuộc tính, số ô trống) và biểu đồ phân bố tần suất.

### Bước 2: Tiền xử lý (Preprocess)

1. Chuyển sang danh mục **Preprocess** trên Sidebar.  
2. Lựa chọn bộ lọc làm sạch phù hợp tại ô chọn:  
3. Nhấp nút để thực thi bộ lọc và quan sát dữ liệu sạch ở bảng preview bên phải.

### Bước 3: Cấu hình và chạy thuật toán (ML Task)**

1. Chọn mục ML Task.
2. Lựa chọn thuật toán thích hợp và chọn siêu tham số thích hợp.
3. Chọn các cột cần gom cụm.
4. Chạy Run Clustering.

### Bước 4: Trả về kết quả gom cụm tương ứng.