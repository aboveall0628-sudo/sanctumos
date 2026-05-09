$inputPath = "bible.json"
$outputPath = "bibleData.js"

$bytes = [System.IO.File]::ReadAllBytes($inputPath)
$base64 = [System.Convert]::ToBase64String($bytes)

# Split into 500KB chunks to avoid large string limits
$chunkSize = 500000
$chunks = @()
for ($i = 0; $i -lt $base64.Length; $i += $chunkSize) {
    $end = [Math]::Min($chunkSize, $base64.Length - $i)
    $chunks += "'" + $base64.Substring($i, $end) + "'"
}

$js = "var BIBLE_CHUNKS = [" + ($chunks -join ",") + "];"

[System.IO.File]::WriteAllText($outputPath, $js, [System.Text.Encoding]::UTF8)

Write-Host "bibleData.js re-generated with chunked Base64 for better stability."
