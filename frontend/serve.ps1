# Einfacher lokaler Webserver ohne Zusatzsoftware (kein Node/Python nötig).
# Aufruf: Rechtsklick > "Mit PowerShell ausführen" oder im Terminal: .\serve.ps1
param(
  [int]$Port = 8080
)

$Root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Host "Konnte Port $Port nicht offnen (evtl. schon belegt). Versuche: .\serve.ps1 -Port 8081" -ForegroundColor Red
  exit 1
}

Write-Host "Server laeuft: http://localhost:$Port/  (Strg+C zum Beenden)" -ForegroundColor Green

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    try {
      $localPath = $request.Url.LocalPath
      if ($localPath -eq "/") { $localPath = "/index.html" }
      $filePath = Join-Path $Root ($localPath.TrimStart("/") -replace "/", "\")

      if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $contentType = $mimeTypes[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 - Nicht gefunden: $localPath")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
      }
    } finally {
      $response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
