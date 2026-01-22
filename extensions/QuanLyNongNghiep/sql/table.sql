CREATE TABLE IF NOT EXISTS /*_*/nongnghiep40_resources (
    nn_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nn_name VARCHAR(255) NOT NULL,
    nn_url TEXT NOT NULL,
    nn_summary TEXT NOT NULL,
    nn_category VARCHAR(190) NOT NULL,
    nn_added_by INT UNSIGNED NOT NULL,  -- User ID thêm bản ghi
    nn_timestamp BINARY(14) NOT NULL    -- Thời gian thêm
) /*$wgDBTableOptions*/;

CREATE INDEX /*i*/nn_name ON /*_*/nongnghiep40_resources (nn_name);
CREATE INDEX /*i*/nn_category ON /*_*/nongnghiep40_resources (nn_category);