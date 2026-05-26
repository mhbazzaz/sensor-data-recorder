# راهنمای اجرای پروژه روی ویندوز

این راهنما فقط برای اجرای پروژه روی ویندوز و روی دستگاه واقعی نوشته شده است و از فایل `start.ps1` استفاده می‌کند.

## 1. نصب Docker Desktop

1. Docker را از این آدرس دانلود کنید:
   [دانلود Docker 4.52.0 - نرم افزار داکر](https://www.yasdl.com/309404/%D8%AF%D8%A7%D9%86%D9%84%D9%88%D8%AF-docker.html)
2. نسخه Windows را دانلود و نصب کنید.
3. بعد از نصب، Docker Desktop را باز کنید.
4. صبر کنید تا Docker کامل بالا بیاید.
5. اگر پیام خطا دیدید، سیستم را یک‌بار ری‌استارت کنید.

## 2. نصب Node.js

1. Node.js را از این آدرس دانلود کنید:
   [دانلود Node.js 26.2.0 Win/Mac](https://www.yasdl.com/176044/%D8%AF%D8%A7%D9%86%D9%84%D9%88%D8%AF-node-js.html)
2. نسخه `LTS` را دانلود و نصب کنید.
3. در مراحل نصب، گزینه‌های پیش‌فرض را نگه دارید.
4. بعد از نصب، یک PowerShell باز کنید و این دستور را بزنید:

```powershell
node -v
```

5. اگر شماره نسخه نمایش داده شد، نصب درست انجام شده است.

## 3. باز کردن پروژه

1. فایل پروژه را روی ویندوز کپی کنید.
2. وارد پوشه اصلی پروژه شوید؛ همان پوشه‌ای که فایل‌های زیر داخل آن هستند:
   - `docker-compose.yml`
   - `start.ps1`
   - `backup-influx.ps1`
   - پوشه `sensor-app`

## 4. باز کردن PowerShell در پوشه پروژه

1. داخل پوشه پروژه، در نوار آدرس File Explorer کلیک کنید.
2. بنویسید:

```powershell
powershell
```

3. کلید Enter را بزنید.

یا:

1. داخل پوشه پروژه راست‌کلیک کنید.
2. گزینه `Open in Terminal` یا `Open PowerShell window here` را بزنید.

## 5. اجازه اجرای فایل PowerShell

اگر ویندوز اجازه اجرای فایل `ps1` نداد، این دستور را در PowerShell اجرا کنید:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

اگر سوال پرسیده شد، `Y` را بزنید.

این تغییر فقط برای همان پنجره PowerShell است.

## 6. اجرای پروژه

در همان پوشه پروژه این دستور را اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

این دستور همه بخش‌های لازم را از همان پنجره PowerShell اجرا می‌کند و پنجره PowerShell جداگانه‌ای برای بکاپ باز نمی‌شود.

## 7. کاری که اسکریپت انجام می‌دهد

فایل `start.ps1` این کارها را انجام می‌دهد:

1. بررسی می‌کند که Docker اجرا شده باشد.
2. بررسی می‌کند که Node.js نصب باشد.
3. کانتینرهای قبلی را متوقف می‌کند.
4. سرویس‌های Docker را بالا می‌آورد:
   - `mosquitto`
   - `influxdb`
   - `nodered`
5. صبر می‌کند تا سرویس‌ها آماده شوند.
6. برنامه اصلی Node.js را اجرا می‌کند.
7. بکاپ خودکار InfluxDB را هم داخل همان روند اجرایی فعال می‌کند.
8. بررسی می‌کند که داده وارد InfluxDB شده باشد.

## 8. اگر اجرا موفق باشد

در انتهای اجرا باید آدرس‌های زیر را ببینید:

- Node-RED:
  `http://localhost:1880`
- InfluxDB:
  `http://localhost:8086`

اطلاعات ورود InfluxDB:

- username: `admin`
- password: `admin123`

## 9. محل لاگ‌ها

بعد از اجرا، لاگ‌ها داخل پوشه `logs` ذخیره می‌شوند:

- `logs\receiver.log`
- `logs\backup-influx.log`

لاگ‌ها داخل فایل ذخیره می‌شوند و پیام‌های بکاپ در پنجره جداگانه نمایش داده نمی‌شوند.

## 10. محل بکاپ‌ها

بکاپ InfluxDB در این مسیر ذخیره می‌شود:

```text
backups\influxdb\latest
```

بکاپ خودکار هر روز ساعت `02:00 AM` اجرا می‌شود.
این بکاپ از داخل همان اجرای `start.ps1` زمان‌بندی می‌شود و PowerShell جدیدی باز نمی‌کند.

## 11. توقف پروژه

برای توقف برنامه‌ها:

1. به همان پنجره PowerShell که `start.ps1` را در آن اجرا کرده‌اید برگردید.
2. کلیدهای زیر را بزنید:

```text
Ctrl + C
```

این کار برنامه‌های Node.js را متوقف می‌کند.

## 12. اتصال دستگاه واقعی

برای استفاده روی دستگاه واقعی:

1. دستگاه یا سنسور واقعی باید داده‌ها را به MQTT ارسال کند.
2. آدرس MQTT در پروژه به‌صورت پیش‌فرض این است:

```text
mqtt://localhost:1883
```

3. اگر سنسور روی همان سیستم ویندوزی اجرا نمی‌شود، باید IP سیستم ویندوزی را به‌جای `localhost` در تنظیمات سنسور وارد کنید.
4. برنامه `start.ps1` دیگر `mock-sensor.js` را اجرا نمی‌کند.
5. فقط داده‌های واقعی که از دستگاه شما به Mosquitto برسند وارد InfluxDB می‌شوند.

## 13. اجرای دستی بکاپ

اگر خواستید فقط بکاپ InfluxDB را دستی اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File .\backup-influx.ps1
```

## 14. اگر خطا گرفتید

### Docker بالا نیست

اگر این پیام را دیدید:

```text
[FAIL] Docker is not running. Start Docker Desktop first.
```

یعنی باید Docker Desktop را باز کنید و صبر کنید کامل اجرا شود.

### Node.js نصب نیست

اگر این پیام را دیدید:

```text
[FAIL] Node.js is not installed.
```

یعنی باید Node.js را نصب کنید.

### اجرای PowerShell بسته شده است

اگر فایل `ps1` اجرا نشد، دوباره این دستور را بزنید:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

و بعد دوباره `start.ps1` را اجرا کنید.

## 15. دستور نهایی سریع

اگر همه‌چیز نصب است، فقط این دو دستور کافی است:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
powershell -ExecutionPolicy Bypass -File .\start.ps1
```
