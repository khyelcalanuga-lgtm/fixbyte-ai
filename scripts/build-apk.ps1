param(
    [Parameter(Mandatory = $true)]
    [string]$ApiUrl,
    [string]$Architectures = 'arm64-v8a,armeabi-v7a,x86_64'
)

$ErrorActionPreference = 'Stop'
$apiUri = $null
if (-not [Uri]::TryCreate($ApiUrl, [UriKind]::Absolute, [ref]$apiUri) -or $apiUri.Scheme -notin @('http', 'https')) {
    throw 'ApiUrl must be an absolute HTTP or HTTPS URL.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$studioJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $studioJava)) { $env:JAVA_HOME = $studioJava }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw 'Install the Android SDK or set ANDROID_HOME.' }
$env:EXPO_PUBLIC_API_URL = $ApiUrl.TrimEnd('/')
$env:CI = '1'
$env:NODE_ENV = 'production'

Push-Location $projectRoot
try {
    # Android's bundled Ninja 1.10 cannot handle some generated Windows paths.
    $ninjaTool = Join-Path $projectRoot '.android-tools\ninja.exe'
    if (-not (Test-Path -LiteralPath $ninjaTool)) {
        New-Item -ItemType Directory -Path .android-tools -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ninja-build/ninja/releases/download/v1.13.1/ninja-win.zip' -OutFile '.android-tools\ninja-win.zip'
        Expand-Archive -LiteralPath '.android-tools\ninja-win.zip' -DestinationPath '.android-tools' -Force
    }
    & node node_modules/expo/bin/cli prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Android prebuild failed.' }
    Push-Location android
    try {
        & .\gradlew.bat :app:assembleRelease "-PreactNativeArchitectures=$Architectures" '-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=1024m' --max-workers=4 --init-script ../scripts/android-build.init.gradle --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'APK compilation failed.' }
    } finally { Pop-Location }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    Copy-Item -LiteralPath android/app/build/outputs/apk/release/app-release.apk -Destination artifacts/FixByte-AI-test.apk
    Write-Output "APK: $projectRoot\artifacts\FixByte-AI-test.apk"
} finally { Pop-Location }
