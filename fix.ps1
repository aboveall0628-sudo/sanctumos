
$path = "bible.json"
$out = "bibleData.js"

# Read as UTF8 since view_file showed it correctly
$content = [System.IO.File]::ReadAllText((Get-Item $path).FullName, [System.Text.Encoding]::UTF8)

# Build formatted JS
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("var BIBLE_DATA = {")

# Split content into lines
# Bible JSON is usually one verse per line
$lines = $content -split "`r?`n"
$currentBook = ""

foreach ($line in $lines) {
    if ($line -match '"([^"]+)":\s*"([^"]+)"') {
        $key = $matches[1]
        $val = $matches[2]
        
        $bookMatch = [regex]::Match($key, "^([^\d]+)")
        if ($bookMatch.Success) {
            $book = $bookMatch.Groups[1].Value
            if ($book -ne $currentBook) {
                $currentBook = $book
                [void]$sb.AppendLine("")
                [void]$sb.AppendLine("  // --- $book ---")
            }
        }
        [void]$sb.AppendLine("  `"$key`": `"$val`",")
    }
}

[void]$sb.AppendLine("};")

# Write as UTF8
[System.IO.File]::WriteAllText((Get-Item ".").FullName + "\" + $out, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "bibleData.js has been reformatted with UTF-8 encoding."
