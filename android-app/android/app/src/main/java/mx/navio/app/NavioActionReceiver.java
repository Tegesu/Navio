package mx.navio.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

/** Los botones "Responder" y "Marcar como leído" de las notificaciones. */
public class NavioActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        final boolean reply = NavioNotifier.ACTION_REPLY.equals(intent.getAction());
        final long channelId = intent.getLongExtra("channelId", 0);
        final int notifId = intent.getIntExtra("notifId", 0);
        String text = null;
        if (reply) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence typed = results == null ? null : results.getCharSequence(NavioNotifier.REPLY_KEY);
            text = typed == null ? null : typed.toString().trim();
            if (text == null || text.isEmpty()) return;
        }
        if (channelId <= 0) return;
        final String body = text;
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                boolean ok = NavioNotifier.sendAction(ctx, channelId, reply ? "reply" : "read", body);
                if (ok) NotificationManagerCompat.from(ctx).cancel(notifId);
                else NavioNotifier.showFailure(ctx, notifId, reply ? "Tu respuesta no salió. Abre Navio para enviarla." : "Abre Navio para marcar el chat como leído.");
            } finally {
                pending.finish();
            }
        }).start();
    }
}
