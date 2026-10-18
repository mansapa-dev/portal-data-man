package id.man1palembang.arena;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
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

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) getWindow().setHideOverlayWindows(true);
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
    @Override protected void onPause() { if (webView != null) webView.onPause(); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) { if (webView != null) webView.saveState(state); super.onSaveInstanceState(state); }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (webView != null) { webView.stopLoading(); webView.setWebChromeClient(null); webView.setWebViewClient(null); webView.destroy(); webView = null; } super.onDestroy(); }
}
