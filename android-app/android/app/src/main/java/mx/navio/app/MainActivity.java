package mx.navio.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private static final int NOTIFICATIONS_REQUEST = 4201;
    /** Sección de Navio que abre una notificación (por ejemplo /?open=messages&sub=channel:12). */
    static final String EXTRA_URL = "navio_url";
    private static volatile boolean visible = false;
    /** Lo que ocupan las barras del sistema, en dp: arriba, derecha, abajo, izquierda. */
    private int[] safeArea = { 0, 0, 0, 0 };

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
        edgeToEdge();
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

    /**
     * Pantalla de borde a borde: la página se dibuja también detrás de la barra
     * de estado y de la barra de gestos, sin franjas grises arriba ni abajo.
     * La página recibe cuánto miden esas barras en las variables CSS
     * --navio-safe-top/right/bottom/left para acomodar lo que va pegado a los
     * bordes (el encabezado y la barra inferior). Funciona con cualquier versión
     * del WebView, también con las que no reportan env(safe-area-inset-*).
     */
    private void edgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // Desde Android 15 ya son transparentes; antes hay que pedirlo.
            window.setStatusBarColor(Color.TRANSPARENT);
            // Android 7 no oscurece los botones de navegación: un velo tenue los deja ver.
            window.setNavigationBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? Color.TRANSPARENT : 0x66000000);
        }
        View decor = window.getDecorView();
        int bars = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets system = insets.getInsets(bars);
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            // Con el teclado abierto, la página se encoge para quedar arriba de él.
            v.setPadding(0, 0, 0, keyboard ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0);
            int bottom = keyboard ? 0 : system.bottom;
            float density = getResources().getDisplayMetrics().density;
            safeArea = new int[] {
                Math.round(system.top / density),
                Math.round(system.right / density),
                Math.round(bottom / density),
                Math.round(system.left / density),
            };
            sendSafeArea();
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(bars, Insets.of(system.left, system.top, system.right, bottom))
                .build();
        });
        // Cada página nueva (o recarga) vuelve a recibir las medidas.
        if (getBridge() == null) return;
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                sendSafeArea();
            }

            @Override
            public void onPageLoaded(WebView webView) {
                sendSafeArea();
            }
        });
        ViewCompat.requestApplyInsets(decor);
    }

    private void sendSafeArea() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        int[] s = safeArea;
        String js = String.format(
            Locale.US,
            "(function(r){r.setProperty('--navio-safe-top','%dpx');r.setProperty('--navio-safe-right','%dpx');"
                + "r.setProperty('--navio-safe-bottom','%dpx');r.setProperty('--navio-safe-left','%dpx');"
                + "window.dispatchEvent(new Event('navio:safearea'));})(document.documentElement.style)",
            s[0], s[1], s[2], s[3]
        );
        WebView web = getBridge().getWebView();
        web.post(() -> web.evaluateJavascript(js, null));
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
