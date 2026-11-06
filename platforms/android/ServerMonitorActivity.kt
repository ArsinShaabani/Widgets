package com.widgets.servermonitor

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Hosts the canvas-rendered server monitor inside an Android WebView.
 *
 * The activity can either let the widget stream straight from your backend or
 * keep the credentials in Kotlin and forward snapshots with [pushSnapshot].
 */
class ServerMonitorActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server_monitor)

        webView = findViewById(R.id.serverMonitorView)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The widget is fully local: no file access needed beyond the bundle.
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !request.url.host.equals("widgets.local")
        }
        webView.addJavascriptInterface(WidgetBridge(), "AndroidBridge")

        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    /** Pushes a canonical snapshot produced natively (OkHttp, gRPC, Room cache…). */
    fun pushSnapshot(snapshot: JSONObject) {
        val script = "window.__widgets.setSnapshot($snapshot)"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    /** Re-subscribe / re-poll the active transport (pull-to-refresh, FCM ping…). */
    fun refreshWidget() {
        webView.post { webView.evaluateJavascript("window.__widgets.refresh();", null) }
    }

    /** Bridge the widget's affordances back into native navigation. */
    inner class WidgetBridge {
        @JavascriptInterface
        fun onAction(payload: String) {
            val detail = JSONObject(payload)
            when (detail.optString("action")) {
                "logs" -> runOnUiThread { openLogConsole() }
                "settings" -> runOnUiThread { openSettings() }
                "link" -> runOnUiThread { openDashboard() }
            }
        }

        @JavascriptInterface
        fun onAlert(payload: String) {
            // Forward to your notification channel / crash reporter.
        }
    }

    private fun openLogConsole() = Unit
    private fun openSettings() = Unit
    private fun openDashboard() = Unit

    override fun onPause() {
        super.onPause()
        // Stop polling/streaming while the activity is backgrounded.
        webView.evaluateJavascript("window.__widgets.stop();", null)
    }

    override fun onResume() {
        super.onResume()
        webView.evaluateJavascript("window.__widgets.start();", null)
    }
}
