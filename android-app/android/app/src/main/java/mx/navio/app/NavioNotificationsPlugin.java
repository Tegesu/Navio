package mx.navio.app;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lo que la página le dice a la app sobre las notificaciones: la clave de este
 * teléfono (para responder desde el aviso) y qué chat se abrió (para quitar
 * su notificación).
 */
@CapacitorPlugin(name = "NavioNotifications")
public class NavioNotificationsPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("rich", true);
        result.put("version", 1);
        call.resolve(result);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String token = call.getString("token");
        String secret = call.getString("secret");
        String url = call.getString("url");
        String anon = call.getString("anon");
        if (token == null || secret == null || url == null || anon == null || !url.startsWith("https://")) {
            call.reject("Datos incompletos.");
            return;
        }
        NavioNotifier.prefs(getContext()).edit()
            .putString("token", token)
            .putString("secret", secret)
            .putString("url", url)
            .putString("anon", anon)
            .apply();
        NavioNotifier.ensureChannels(getContext());
        call.resolve();
    }

    @PluginMethod
    public void forget(PluginCall call) {
        NavioNotifier.prefs(getContext()).edit().clear().apply();
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Long channelId = call.getLong("channelId");
        if (channelId != null) NotificationManagerCompat.from(getContext()).cancel(("chat-" + channelId).hashCode());
        call.resolve();
    }
}
