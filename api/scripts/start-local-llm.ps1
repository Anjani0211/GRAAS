# Start llama.cpp server for GRAAS local LLM evaluation.
# Requires llama-server on PATH (https://github.com/ggml-org/llama.cpp/releases)
#
# Usage:
#   .\scripts\start-local-llm.ps1
#   .\scripts\start-local-llm.ps1 -ModelPath "E:\autobot projects\GRAAS\gemma2b-cyberpeace-victim-ocr-q4_k_m.gguf"

param(
  [string]$ModelPath = $env:LOCAL_LLM_MODEL_PATH,
  [int]$Port = 8080,
  [int]$CtxSize = 4096
)

if (-not $ModelPath) {
  Write-Error "Set LOCAL_LLM_MODEL_PATH or pass -ModelPath to the GGUF file."
  exit 1
}

if (-not (Test-Path -LiteralPath $ModelPath)) {
  Write-Error "Model not found: $ModelPath"
  exit 1
}

$llamaServer = Get-Command llama-server -ErrorAction SilentlyContinue
if (-not $llamaServer) {
  Write-Error "llama-server not found on PATH. Install llama.cpp and add llama-server to PATH."
  exit 1
}

Write-Host "Starting llama-server on http://127.0.0.1:$Port/v1"
Write-Host "Model: $ModelPath"

& llama-server `
  -m $ModelPath `
  --host 127.0.0.1 `
  --port $Port `
  --ctx-size $CtxSize
