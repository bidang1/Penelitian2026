<?php

use App\Http\Controllers\DeviceApiController;
use Illuminate\Support\Facades\Route;

// Hardware IoT endpoints (ESP8266 REST mode)
Route::match(['get', 'post'], '/check_uid', [DeviceApiController::class, 'checkUid']);
Route::match(['get', 'post'], '/check_uid.php', [DeviceApiController::class, 'checkUid']);

Route::match(['get', 'post'], '/esp_status', [DeviceApiController::class, 'espStatus']);
Route::match(['get', 'post'], '/esp_status.php', [DeviceApiController::class, 'espStatus']);
