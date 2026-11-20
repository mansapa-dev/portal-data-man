package id.man1palembang.arena;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.net.URI;

public final class MainActivity extends Activity {
    private WebView webView;
    private View multiWindowShield;
    private String arenaOrigin;
    // Mode ujian: immersive fullscreen + screen pinning (Lock Task). Diaktifkan
    // halaman ujian lewat ArenaApp.setExamMode(true) dan dilepas ketika siswa
    // membuka bantuan, ada error, waktu habis, atau sesi selesai.
    private boolean examMode = false;
    // Dialog konfirmasi screen pinning mengambil fokus jendela; jangan sampai
    // episode itu tercatat sebagai pelanggaran siswa. Diisi saat startLockTask.
    private long pinningGraceUntil = 0L;
    // Grace fokus 1 detik: dialog sistem (volume, notifikasi, kamera) mengembalikan
    // fokus dalam sekejap dan tidak dihitung; overlay/aplikasi lain yang benar-benar
    // menutup layar tetap tercatat setelah grace berlalu.
    private final Handler focusHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingFocusLoss;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Butuh permission normal HIDE_OVERLAY_WINDOWS (lihat manifest).
            // Dibungkus try/catch agar OEM yang menolak tidak membuat app crash.
            try {
                getWindow().setHideOverlayWindows(true);
            } catch (RuntimeException ignored) {
                /* overlay tetap dicatat lewat sinyal fokus/tab hidden */
            }
        }
        // API 34+: tidak menyimpan screenshot ke recents/task switcher.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) setRecentsScreenshotEnabled(false);
        arenaOrigin = configuredOrigin();

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setFilterTouchesWhenObscured(true);
        configureWebView();
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        TextView shield = new TextView(this);
        shield.setText("Ujian tidak dapat dibuka dalam mode layar terbagi.");
        shield.setTextColor(Color.WHITE);
        shield.setTextSize(18);
        shield.setGravity(Gravity.CENTER);
        shield.setPadding(32, 32, 32, 32);
        shield.setBackgroundColor(Color.rgb(0, 92, 47));
        root.addView(shield, new FrameLayout.LayoutParams(-1, -1));
        multiWindowShield = shield;
        setContentView(root);

        boolean restored = state != null && webView.restoreState(state) != null;
        if (!restored) webView.loadUrl(arenaOrigin + "/");
        updateMultiWindowShield();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) registerPredictiveBack();
    }

    private String configuredOrigin() {
        Uri uri = Uri.parse(BuildConfig.ARENA_BASE_URL);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))) {
            throw new IllegalStateException("ARENA_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.");
        }
        int port = uri.getPort();
        return "https://" + uri.getHost().toLowerCase() + (port == -1 || port == 443 ? "" : ":" + port);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        // Bridge 1 klien -> shell, hanya untuk keperluan sinyal ujian yang aman.
        // Sistem file, konten, dan navigasi duplikat sudah diblokir, sehingga
        // interface ini hanya membuka kemampuan menopang layar (keep-awake).
        webView.addJavascriptInterface(new ArenaBridge(), "ArenaApp");
        settings.setJavaScriptEnabled(true); // Required by the Arena web application.
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && !isArenaUrl(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isArenaUrl(Uri.parse(url));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadData("<meta name='viewport' content='width=device-width'><p style='font:16px sans-serif;padding:24px'>Arena tidak dapat dijangkau. Periksa koneksi lalu muat ulang.</p>", "text/html", "UTF-8");
            }
        });
    }

    private boolean isArenaUrl(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return false;
        try {
            URI expected = URI.create(arenaOrigin);
            return expected.getHost().equalsIgnoreCase(uri.getHost()) && effectivePort(expected.getPort()) == effectivePort(uri.getPort());
        } catch (RuntimeException error) { return false; }
    }
    private int effectivePort(int port) { return port == -1 ? 443 : port; }

    private void updateMultiWindowShield() {
        boolean blocked = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInMultiWindowMode();
        multiWindowShield.setVisibility(blocked ? View.VISIBLE : View.GONE);
        webView.setVisibility(blocked ? View.INVISIBLE : View.VISIBLE);
    }
    @Override public void onMultiWindowModeChanged(boolean value) { super.onMultiWindowModeChanged(value); updateMultiWindowShield(); }
    @Override public void onMultiWindowModeChanged(boolean value, Configuration configuration) { super.onMultiWindowModeChanged(value, configuration); updateMultiWindowShield(); }
    @Override protected void onResume() { super.onResume(); if (webView != null) webView.onResume(); if (multiWindowShield != null) updateMultiWindowShield(); }
    @Override protected void onPause() {
        // Suntik event sebelum webView.onPause() supaya halaman sempat mengirim
        // pelanggaran lewat fetch keepalive. Salah satu pesan di pause/resume/fokus
        // yang penting sampai; server menyatukan burst ini jadi SATU pelanggaran
        // lewat (attempt,event_key) yang sama di halaman ujian.
        notifyHostHidden();
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override public void onUserLeaveHint() { super.onUserLeaveHint(); notifyHostHidden(); }
    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Kehilangan fokus = ada overlay di atas kita (mis. asisten Gemini/quick
        // intent). visibilitychange tidak jalan di kasus ini, sehingga bridge ini
        // satu-satunya sinyalnya. Beri grace 1 detik seperti perilaku blur di web
        // agar dialog sistem sekilas tidak memicu pelanggaran.
        if (pendingFocusLoss != null) { focusHandler.removeCallbacks(pendingFocusLoss); pendingFocusLoss = null; }
        if (!hasFocus) {
            pendingFocusLoss = new Runnable() { @Override public void run() { notifyHostHidden(); } };
            focusHandler.postDelayed(pendingFocusLoss, 1000L);
        } else if (examMode) {
            // System bar bisa muncul lagi setelah dialog/overlay; paksa sembunyi.
            applyExamSystemUi(true);
            // Setelah pinning diterima, fokus kembali normal: hentikan grace agar
            // percobaan Home berikutnya tetap tercatat.
            ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
                pinningGraceUntil = 0L;
            }
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) { if (webView != null) webView.saveState(state); super.onSaveInstanceState(state); }
    private void notifyHostHidden() {
        if (webView == null) return;
        // Saat mode ujian baru dimulai, dialog pinning sistem boleh mengambil
        // fokus tanpa dihitung sebagai upaya keluar siswa.
        if (examMode && SystemClock.uptimeMillis() < pinningGraceUntil) return;
        try {
            webView.evaluateJavascript("try{document.dispatchEvent(new CustomEvent('arena-host-hidden'))}catch(e){}", null);
        } catch (RuntimeException ignored) { /* detached webview or during teardown */ }
    }
    /** Sembunyikan/tampilkan status bar & navigation bar (mode immersive). */
    private void applyExamSystemUi(boolean enabled) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Api30SystemUi.apply(this, enabled);
            return;
        }
        View decor = getWindow().getDecorView();
        if (enabled) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    /** Isolasi API 30+ agar perangkat lama tidak memverifikasi kelas yang belum ada. */
    @android.annotation.TargetApi(Build.VERSION_CODES.R)
    private static final class Api30SystemUi {
        static void apply(Activity activity, boolean enabled) {
            WindowInsetsController controller = activity.getWindow().getInsetsController();
            if (controller == null) return;
            if (enabled) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                controller.show(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_DEFAULT);
            }
        }
    }

    /**
     * Screen pinning / Lock Task. Tanpa device owner Android menampilkan dialog
     * konfirmasi pin sekali; setelah dipin, tombol Home/Recents tidak bisa
     * meninggalkan aplikasi. Untuk kiosk penuh (tanpa gesture unpin), daftarkan
     * paket lewat device owner / MDM.
     */
    private void startExamLock() {
        try {
            ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (manager != null && manager.getLockTaskModeState() == ActivityManager.LOCK_TASK_MODE_NONE) {
                pinningGraceUntil = SystemClock.uptimeMillis() + 12000L;
                startLockTask();
            }
        } catch (RuntimeException ignored) {
            /* perangkat/OEM menolak screen pinning; immersive tetap aktif */
        }
    }

    private void stopExamLock() {
        pinningGraceUntil = 0L;
        try {
            ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (manager != null && manager.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
                stopLockTask();
            }
        } catch (RuntimeException ignored) {
            /* tidak sedang terkunci */
        }
    }

    private void handleBack() {
        // Selama mode ujian, tombol Back tidak boleh meninggalkan layar ujian.
        if (examMode) return;
        if (webView != null && webView.canGoBack()) webView.goBack(); else finish();
    }

    @Override public void onBackPressed() { handleBack(); }

    /** API 33+ memakai OnBackInvokedDispatcher (predictive back). */
    @android.annotation.TargetApi(Build.VERSION_CODES.TIRAMISU)
    private void registerPredictiveBack() {
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                new android.window.OnBackInvokedCallback() {
                    @Override public void onBackInvoked() { handleBack(); }
                });
    }
    @Override protected void onDestroy() { if (examMode) { examMode = false; stopExamLock(); } focusHandler.removeCallbacksAndMessages(null); if (webView != null) { webView.stopLoading(); webView.removeJavascriptInterface("ArenaApp"); webView.setWebChromeClient(null); webView.setWebViewClient(null); webView.destroy(); webView = null; } super.onDestroy(); }

    /**
     * Bridge halaman ujian -> shell. Hanya dua kemampuan boolean yang aman:
     * - setKeepScreenOn: menahan layar agar tidak mati oleh screen timeout;
     * - setExamMode: immersive fullscreen + screen pinning selama ujian.
     * Tanpa akses file, konten, atau navigasi, sehingga aman dipanggil halaman
     * mana pun di dalam webview (yang hanya memuat origin Arena).
     */
    public final class ArenaBridge {
        @JavascriptInterface public void setKeepScreenOn(final boolean enabled) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /**
         * Aktifkan/nonaktifkan mode ujian: immersive fullscreen + screen pinning.
         * Halaman ujian memanggil ini saat attempt aktif dan melepasnya ketika
         * siswa membuka bantuan, mengalami error, waktu habis, atau selesai.
         */
        @JavascriptInterface public void setExamMode(final boolean enabled) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    examMode = enabled;
                    applyExamSystemUi(enabled);
                    if (enabled) startExamLock(); else stopExamLock();
                }
            });
        }

        @JavascriptInterface public boolean isExamMode() { return examMode; }
    }
}
