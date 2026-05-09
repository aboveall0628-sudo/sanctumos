
$path = "bible.json"
$encodings = @("Default", "UTF8", "Unicode", "BigEndianUnicode", "UTF32")
foreach ($encName in $encodings) {
    Write-Host "--- $encName ---"
    try {
        $c = Get-Content $path -Encoding $encName -TotalCount 2
        Write-Host $c
    } catch {
        Write-Host "Failed"
    }
}
