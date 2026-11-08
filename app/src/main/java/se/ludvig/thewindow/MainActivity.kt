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

        // ---- dalarkivet: gamla dalar sparas som egna filer ----
        private fun archDir(): File { val d = File(filesDir, "archive"); d.mkdirs(); return d }
        private fun safeId(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")

        @JavascriptInterface
        fun archiveSave(id: String, meta: String, data: String) {
            val d = archDir(); val s = safeId(id)
            val tmp = File(d, "$s.tmp"); tmp.writeText(data); tmp.renameTo(File(d, "$s.json"))
            File(d, "$s.meta").writeText(meta)
        }

        @JavascriptInterface
        fun archiveList(): String {
            val metas = archDir().listFiles { f -> f.name.endsWith(".meta") }?.map { it.readText() } ?: emptyList()
            return "[" + metas.joinToString(",") + "]"
        }

        @JavascriptInterface
        fun archiveLoad(id: String): String {
            val f = File(archDir(), safeId(id) + ".json")
            return if (f.exists()) f.readText() else ""
        }

        @JavascriptInterface
        fun archiveDelete(id: String) {
            val s = safeId(id); File(archDir(), "$s.json").delete(); File(archDir(), "$s.meta").delete()
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
