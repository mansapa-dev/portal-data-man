package id.man1palembang.arena;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
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
    // Grace fokus 1 detik: dialog sistem (volume, notifikasi, kamera) mengembalikan
    // fokus dalam sekejap dan tidak dihitung; overlay/aplikasi lain yang benar-benar
    // menutup layar tetap tercatat setelah grace berlalu.
    private final Handler focusHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingFocusLoss;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) getWindow().setHideOverlayWindows(true);
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
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) { if (webView != null) webView.saveState(state); super.onSaveInstanceState(state); }
    private void notifyHostHidden() {
        if (webView == null) return;
        try {
            webView.evaluateJavascript("try{document.dispatchEvent(new CustomEvent('arena-host-hidden'))}catch(e){}", null);
        } catch (RuntimeException ignored) { /* detached webview or during teardown */ }
    }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { focusHandler.removeCallbacksAndMessages(null); if (webView != null) { webView.stopLoading(); webView.removeJavascriptInterface("ArenaApp"); webView.setWebChromeClient(null); webView.setWebViewClient(null); webView.destroy(); webView = null; } super.onDestroy(); }

    /**
     * Bridge halaman ujian -> shell. Selama attempt ujian aktif, halaman memanggil
     * ArenaApp.setKeepScreenOn(true) agar layar tidak mati sendiri oleh screen
     * timeout; layar yang tadinya mati oleh sistem memicu pause/fokus hilang yang
     * tercatat sebagai pelanggaran. Capability ini sengaja hanya satu tombol
     * boolean: tanpa file, tanpa konten, tanpa navigasi, aman jika disentuh
     * halaman mana pun di dalam webview (yang hanya memuat origin Arena).
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
    }
}
