package mx.navio.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int NOTIFICATIONS_REQUEST = 4201;
    /** Sección de Navio que abre una notificación (por ejemplo /?open=messages&sub=channel:12). */
    static final String EXTRA_URL = "navio_url";
    private static volatile boolean visible = false;

    static boolean isVisible() {
        return visible;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // "Agregar a WhatsApp" para los stickers de Mensajes.
        registerPlugin(WhatsAppStickersPlugin.class);
        // Notificaciones armadas por la app (responder desde el aviso).
        registerPlugin(NavioNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
        NavioNotifier.ensureChannels(this);
        // Android 13 o más reciente: sin este permiso no se ven los avisos ni el
        // aviso fijo de "viaje en curso" que acompaña al registro en segundo plano.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATIONS_REQUEST);
        }
        // Se abrió tocando una notificación: carga esa sección.
        String url = getIntent() != null ? getIntent().getStringExtra(EXTRA_URL) : null;
        if (NavioNotifier.safeUrl(url) && getBridge() != null) {
            WebView web = getBridge().getWebView();
            web.post(() -> web.loadUrl(NavioNotifier.SITE + url));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intent != null ? intent.getStringExtra(EXTRA_URL) : null;
        if (!NavioNotifier.safeUrl(url) || getBridge() == null) return;
        // Navio ya estaba abierto: la página cambia de sección sin recargar.
        WebView web = getBridge().getWebView();
        String js = "window.postMessage({type:'navio:open',url:'" + url + "'}, location.origin)";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
    }

    @Override
    public void onPause() {
        visible = false;
        super.onPause();
    }
}
