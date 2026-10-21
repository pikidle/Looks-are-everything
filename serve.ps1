# 로컬 미리보기용 간이 웹서버.
# index.html을 더블클릭(file://)으로 열면 Ollama가 요청을 막아서 AI 추천 이유가 나오지 않는다.
# 사용법: 이 폴더에서  powershell -ExecutionPolicy Bypass -File serve.ps1  실행 후 http://localhost:8000 접속
param([int]$Port = 8000)

$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "http://localhost:$Port 에서 실행 중입니다. 끝내려면 Ctrl+C를 누르세요."

try {
  while ($listener.IsListening) {
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(500)) { } # Ctrl+C가 먹히도록 짧게 나눠 기다린다
    $ctx = $task.Result
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if (-not $path) { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $type = $types[[IO.Path]::GetExtension($file).ToLower()]
      $ctx.Response.ContentType = if ($type) { $type } else { 'application/octet-stream' }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
}
