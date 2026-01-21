-- ApiPlantDB/sql/create_plantdb_map.sql
CREATE TABLE /*_*/plantdb_map (
    pm_page_id INT UNSIGNED NOT NULL PRIMARY KEY,
    pm_plantdb_id VARCHAR(255) NOT NULL
) /*$wgDBTableOptions*/;

CREATE INDEX /*i*/pm_plantdb_id ON /*_*/plantdb_map (pm_plantdb_id);