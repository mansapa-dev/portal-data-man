<?php

return [
    'max_rows' => (int) env('IMPORT_MAX_ROWS', 5000),
    'max_file_size_mb' => (int) env('IMPORT_MAX_FILE_SIZE_MB', 10),
    'chunk_size' => 100,
];
