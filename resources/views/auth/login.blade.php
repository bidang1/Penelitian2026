<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Administrator - Presensi HIMATIF UMS</title>
  <link rel="icon" type="image/x-icon" href="{{ asset('assets/Image/favicon.ico') }}?v=2">
  <link rel="icon" type="image/png" sizes="32x32" href="{{ asset('assets/Image/favicon-32x32.png') }}?v=2">
  <link rel="icon" type="image/png" sizes="16x16" href="{{ asset('assets/Image/favicon-16x16.png') }}?v=2">
  <link rel="apple-touch-icon" sizes="180x180" href="{{ asset('assets/Image/apple-touch-icon.png') }}?v=2">
  <link rel="manifest" href="{{ asset('site.webmanifest') }}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="{{ asset('assets/style.css') }}?v={{ time() }}">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: var(--bg-main);
      padding: 20px;
    }
    .login-container {
      width: 100%;
      max-width: 420px;
    }
    .login-card {
      background: var(--bg-main);
      border: 3px solid #000000;
      box-shadow: 8px 8px 0px #000000;
      padding: 32px 28px;
    }
    .login-header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 3px solid #000000;
      text-align: center;
    }
    .login-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .login-logo-img {
      width: 80px;
      height: 80px;
      object-fit: contain;
      filter: none;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .login-logo-img:hover {
      transform: scale(1.05);
    }
    .login-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--color-yellow);
      color: #000000;
      border: 2px solid #000000;
      padding: 3px 10px;
      font-family: var(--font-mono);
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.12em;
      box-shadow: 2px 2px 0px #000000;
    }
    .login-title {
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 800;
      color: #000000;
      margin: 10px 0 4px 0;
      text-transform: uppercase;
      letter-spacing: -0.01em;
    }
    .login-subtitle {
      font-size: 12px;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-weight: 500;
    }
    .login-error {
      background: #ffffff;
      border: 2px solid var(--color-red);
      color: var(--color-red);
      padding: 12px 14px;
      margin-bottom: 20px;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 4px 4px 0px var(--color-red);
    }
    .login-form .form-group {
      margin-bottom: 18px;
    }
    .login-form .form-label {
      display: block;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #000000;
      margin-bottom: 6px;
    }
    .login-form input[type="text"],
    .login-form input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      font-family: var(--font-sans);
      font-weight: 600;
      color: #000000;
      background: #ffffff;
      border: 2px solid #000000;
      box-shadow: 2px 2px 0px #000000;
      outline: none;
      transition: all 0.15s ease;
    }
    .login-form input:focus {
      box-shadow: 4px 4px 0px var(--color-yellow);
      border-color: #000000;
    }
    .login-btn {
      width: 100%;
      margin-top: 8px;
      padding: 12px;
      font-size: 13px;
      letter-spacing: 0.08em;
    }
    .login-footer {
      margin-top: 20px;
      text-align: center;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      border-top: 1px solid var(--border-color);
      padding-top: 14px;
    }
  </style>
</head>
<body>

<div class="login-container">
  <div class="login-card">

    <div class="login-header">
      <div class="login-brand">
        <img src="{{ asset('assets/Image/logo-himatif-light.png') }}" alt="Logo HIMATIF UMS" class="login-logo-img">
        <span class="login-badge">HIMATIF UMS</span>
      </div>
      <h1 class="login-title">PRESENSI RFID</h1>
      <div class="login-subtitle">Masuk ke Panel Administrator</div>
    </div>

    @if ($errors->any())
      <div class="login-error" role="alert">
        @foreach ($errors->all() as $error)
          <div>[!] {{ $error }}</div>
        @endforeach
      </div>
    @endif

    <form class="login-form" method="POST" action="{{ route('login') }}">
      @csrf
      <div class="form-group">
        <label class="form-label" for="username">Username Administrator</label>
        <input type="text" id="username" name="username" value="{{ old('username') }}" placeholder="Masukkan username" required autofocus autocomplete="username">
      </div>

      <div class="form-group">
        <label class="form-label" for="password">Password</label>
        <input type="password" id="password" name="password" placeholder="Masukkan password" required autocomplete="current-password">
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;">
        <input type="checkbox" id="remember" name="remember" style="width: 16px; height: 16px; accent-color: #000; cursor: pointer;">
        <label for="remember" style="font-family: var(--font-mono); font-size: 11px; font-weight: 700; cursor: pointer;">Ingat sesi login saya</label>
      </div>

      <button type="submit" class="btn btn-warning login-btn">
        MASUK KE SISTEM
      </button>
    </form>

    <div class="login-footer">
      ESP8266 + RFID &bull; Presensi Mahasiswa &amp; Proker HIMA
    </div>

  </div>
</div>

</body>
</html>
