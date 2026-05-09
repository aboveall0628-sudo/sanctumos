
$inputPath = "bible.json"
$outputPath = "bibleData.js"

# Read bible.json with Default (CP949) encoding
$content = Get-Content -Path $inputPath -Encoding Default -Raw
$data = $content | ConvertFrom-Json

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("/**")
[void]$sb.AppendLine(" * Bible Data - Formatted for readability")
[void]$sb.AppendLine(" */")
[void]$sb.AppendLine("var BIBLE_DATA = {")

$currentBook = ""
$currentChapter = ""

# Sort keys to ensure order
$keys = $data.PSObject.Properties.Name | Sort-Object {
    $key = $_
    $match = [regex]::Match($key, "^([^\d]+)(\d+):(\d+)$")
    if ($match.Success) {
        # We don't have the book order here, but sorting by name + numeric chap/verse is better than nothing.
        # Most bibles are already sorted in the JSON.
        $book = $match.Groups[1].Value
        $chap = [int]$match.Groups[2].Value
        $verse = [int]$match.Groups[3].Value
        "{0}_{1:D3}_{2:D3}" -f $book, $chap, $verse
    } else {
        $key
    }
}

foreach ($key in $keys) {
    $val = $data.$key
    
    $match = [regex]::Match($key, "^([^\d]+)(\d+):")
    if ($match.Success) {
        $book = $match.Groups[1].Value
        $chap = $match.Groups[2].Value
        
        if ($book -ne $currentBook) {
            $currentBook = $book
            $currentChapter = ""
            [void]$sb.AppendLine("")
            [void]$sb.AppendLine("  // --- $book ---")
        }
        
        if ($chap -ne $currentChapter) {
            $currentChapter = $chap
            [void]$sb.AppendLine("  // $chap장")
        }
    }
    
    $escapedVal = $val.Replace('"', '\"')
    [void]$sb.AppendLine("  `"$key`": `"$escapedVal`",")
}

# Trim last comma and close object
$result = $sb.ToString().TrimEnd(",`r`n") + "`r`n};"

# Write as UTF8
[System.IO.File]::WriteAllText((Get-Item .).FullName + "\" + $outputPath, $result, [System.Text.Encoding]::UTF8)

Write-Host "bibleData.js has been reformatted successfully."
