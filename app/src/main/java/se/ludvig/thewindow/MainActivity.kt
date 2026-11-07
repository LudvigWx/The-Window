package se.ludvig.thewindow

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.File

class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Appens filer serveras från en riktig https-adress inne i appen,
        // så att JavaScript, lagring och ljud fungerar som i en vanlig webbläsare.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.setBackgroundColor(0xFF05060D.toInt())
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
        }
        web.addJavascriptInterface(Bridge(), "Android")
        setContentView(web)
        hideSystemUi()
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    /** Sparar världen som en fil i appens privata lagring. */
    inner class Bridge {
        @JavascriptInterface
        fun save(data: String) {
            val tmp = File(filesDir, "world.tmp")
            tmp.writeText(data)
            tmp.renameTo(File(filesDir, "world.json"))
        }

        @JavascriptInterface
        fun load(): String {
            val f = File(filesDir, "world.json")
            return if (f.exists()) f.readText() else ""
        }

        @JavascriptInterface
        fun wipe() {
            File(filesDir, "world.json").delete()
        }
    }

    override fun onPause() {
        web.evaluateJavascript("window.onAppPause && window.onAppPause()", null)
        web.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        web.evaluateJavascript("window.onAppResume && window.onAppResume()", null)
        hideSystemUi()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }
}
