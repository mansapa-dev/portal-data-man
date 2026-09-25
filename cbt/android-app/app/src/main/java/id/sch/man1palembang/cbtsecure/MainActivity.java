package id.sch.man1palembang.cbtsecure;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
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
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String CBT_URL = "https://cbt.rdmman1plg.id/";
    private static final String CBT_HOST = "cbt.rdmman1plg.id";

    private WebView webView;
    private TextView multiWindowCover;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Prevent Android's screenshot and screen-recording pipelines from
        // including any pixels from this Activity, not just the exam view.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getWindow().setHideOverlayWindows(true);
        }

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setFilterTouchesWhenObscured(true);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        multiWindowCover = new TextView(this);
        multiWindowCover.setText(R.string.multi_window_blocked);
        multiWindowCover.setTextColor(Color.WHITE);
        multiWindowCover.setTextSize(18);
        multiWindowCover.setGravity(Gravity.CENTER);
        multiWindowCover.setPadding(40, 40, 40, 40);
        multiWindowCover.setBackgroundColor(Color.rgb(0, 92, 47));
        root.addView(multiWindowCover, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        configureWebView();
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(CBT_URL);
        }
        updateMultiWindowCover();
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true); // The existing CBT frontend requires JavaScript.
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isOfficialUrl(request.getUrl())) return false;
                if (request.isForMainFrame()) showToast(R.string.external_link_blocked);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (isOfficialUrl(Uri.parse(url))) return false;
                showToast(R.string.external_link_blocked);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showToast(R.string.load_failed);
            }
        });
    }

    private boolean isOfficialUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && CBT_HOST.equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null;
    }

    private void updateMultiWindowCover() {
        boolean inMultiWindow = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInMultiWindowMode();
        multiWindowCover.setVisibility(inMultiWindow ? View.VISIBLE : View.GONE);
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode) {
        super.onMultiWindowModeChanged(isInMultiWindowMode);
        updateMultiWindowCover();
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode, Configuration newConfig) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig);
        updateMultiWindowCover();
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateMultiWindowCover();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        // Browser history can navigate away from an active exam without using
        // the CBT's own controls. Keep Back from changing the exam page.
        showToast(R.string.back_blocked);
    }

    private void showToast(int message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
