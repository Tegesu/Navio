package mx.navio.app;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

/**
 * Recibe los avisos de Firebase. Los que trae "navio" (datos) los arma la app
 * con NavioNotifier; con Navio abierto y a la vista no se repiten como
 * notificación (ya se ven dentro). Todo se pasa también a la página, como
 * hacía el plugin de Capacitor.
 */
public class NavioMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        String payload = message.getData().get("navio");
        if (payload != null) {
            try {
                JSONObject p = new JSONObject(payload);
                boolean test = "test".equals(p.optString("kind"));
                if (test || !MainActivity.isVisible()) NavioNotifier.show(this, p);
            } catch (Exception ignored) {
                // Aviso con formato desconocido.
            }
        }
        PushNotificationsPlugin.sendRemoteMessage(message);
    }
}
