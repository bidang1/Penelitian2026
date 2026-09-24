<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@yield('title', 'Sistem Presensi HIMATIF - RFID / ESP8266')</title>
  <meta name="description" content="Dashboard Presensi Mahasiswa Berbasis RFID dan IoT ESP8266 HIMATIF UMS">
  <link rel="icon" type="image/x-icon" href="{{ asset('assets/Image/favicon.ico') }}?v=2">
  <link rel="icon" type="image/png" sizes="32x32" href="{{ asset('assets/Image/favicon-32x32.png') }}?v=2">
  <link rel="icon" type="image/png" sizes="16x16" href="{{ asset('assets/Image/favicon-16x16.png') }}?v=2">
  <link rel="apple-touch-icon" sizes="180x180" href="{{ asset('assets/Image/apple-touch-icon.png') }}?v=2">
  <link rel="manifest" href="{{ asset('site.webmanifest') }}">
  <meta name="csrf-token" content="{{ csrf_token() }}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="{{ asset('assets/style.css') }}?v={{ time() }}">
  @stack('styles')
</head>
<body @yield('body-attrs')>

  @yield('content')

  <!-- Toast Notifications Container -->
  <div class="toast-container" id="toast-container"></div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" defer></script>
  <script src="{{ asset('assets/app.js') }}?v={{ time() }}" defer></script>
  <script type="module" src="{{ asset('assets/firebase-service.js') }}?v={{ time() }}"></script>
  @stack('scripts')
</body>
</html>
