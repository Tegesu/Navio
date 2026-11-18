package mx.navio.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Notificaciones de Navio armadas por la app (desde la 1.0.7): conversación
 * con la foto de quien escribe, los últimos mensajes del chat juntos en una
 * sola notificación, vista previa de stickers y GIF pequeños, y los botones
 * "Responder" y "Marcar como leído" (funcionan sin abrir Navio).
 */
public final class NavioNotifier {

    static final String CHANNEL_MESSAGES = "navio_mensajes";
    static final String CHANNEL_CALLS = "navio_llamadas";
    static final String PREFS = "navio_push";
    static final String SITE = "https://navio-fyj2.vercel.app";
    static final String ACTION_REPLY = "mx.navio.app.REPLY";
    static final String ACTION_READ = "mx.navio.app.READ";
    static final String REPLY_KEY = "reply_text";
    private static final int MAX_IMAGE_BYTES = 1_500_000;

    // Los mismos colores que los avatares de la página.
    private static final int[] COLORS = { 0xFF2563EB, 0xFF0891B2, 0xFF059669, 0xFFD97706, 0xFFDC2626, 0xFF7C3AED, 0xFFDB2777, 0xFF475569 };

    private NavioNotifier() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_MESSAGES) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_MESSAGES, "Mensajes y avisos", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Mensajes, tareas y alertas de Navio");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_CALLS) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_CALLS, "Llamadas", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Llamadas y videollamadas de Navio");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 400 });
            nm.createNotificationChannel(ch);
        }
    }

    static int idFor(String tag) {
        return tag == null || tag.isEmpty() ? (int) (System.currentTimeMillis() & 0x7fffffff) : tag.hashCode();
    }

    /** Círculo de color con las iniciales, como en la página. */
    static Bitmap avatar(String name) {
        String clean = name == null || name.trim().isEmpty() ? "?" : name.trim();
        int hash = 0;
        for (int i = 0; i < clean.length(); ) {
            int cp = clean.codePointAt(i);
            hash = hash * 31 + cp;
            i += Character.charCount(cp);
        }
        StringBuilder initials = new StringBuilder();
        for (String word : clean.split("\\s+")) {
            if (word.isEmpty() || initials.codePointCount(0, initials.length()) >= 2) continue;
            initials.appendCodePoint(word.codePointAt(0));
        }
        int size = 128;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(COLORS[(int) (Integer.toUnsignedLong(hash) % COLORS.length)]);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        paint.setColor(Color.WHITE);
        paint.setTextSize(52);
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        paint.setTextAlign(Paint.Align.CENTER);
        float y = size / 2f - (paint.descent() + paint.ascent()) / 2f;
        canvas.drawText(initials.toString().toUpperCase(), size / 2f, y, paint);
        return bmp;
    }

    static boolean safeUrl(String url) {
        return url != null && url.startsWith("/") && url.matches("[A-Za-z0-9/?=&:_%.\\-]{1,300}");
    }

    static PendingIntent openIntent(Context ctx, String url, int requestCode) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.putExtra(MainActivity.EXTRA_URL, safeUrl(url) ? url : "/");
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canNotify(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    /** Arma y muestra el aviso que mandó la función "push". */
    static void show(Context ctx, JSONObject p) {
        if (!canNotify(ctx)) return;
        ensureChannels(ctx);
        String kind = p.optString("kind", "message");
        String tag = p.optString("tag", "");
        int id = idFor(tag);
        String url = p.optString("url", "/");
        NotificationCompat.Builder b;
        if ("message".equals(kind)) b = messageBuilder(ctx, p, id, url);
        else if ("call".equals(kind)) b = callBuilder(ctx, p);
        else b = simpleBuilder(ctx, p);
        b.setContentIntent(openIntent(ctx, url, id));
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // Sin permiso de notificaciones.
        }
    }

    private static NotificationCompat.Builder base(Context ctx, String channel) {
        return new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_navio)
            .setColor(ContextCompat.getColor(ctx, R.color.navio_notification))
            .setAutoCancel(true);
    }

    private static NotificationCompat.Builder messageBuilder(Context ctx, JSONObject p, int id, String url) {
        long channelId = p.optLong("channelId", 0);
        boolean group = p.optBoolean("group", false);
        String title = p.optString("title", "Navio");
        JSONArray lines = p.optJSONArray("lines");
        if (lines == null) lines = new JSONArray();

        Person me = new Person.Builder().setName("Tú").setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        if (group) style.setConversationTitle(title).setGroupConversation(true);

        Uri image = null;
        String imageUrl = p.optString("image", "");
        if (!imageUrl.isEmpty()) image = downloadImage(ctx, imageUrl);

        String lastName = title;
        for (int i = 0; i < lines.length(); i++) {
            JSONObject line = lines.optJSONObject(i);
            if (line == null) continue;
            String name = line.optString("name", "Alguien");
            Person who = new Person.Builder().setName(name).setKey(name).setIcon(IconCompat.createWithBitmap(avatar(name))).build();
            NotificationCompat.MessagingStyle.Message message = new NotificationCompat.MessagingStyle.Message(
                line.optString("text", ""),
                line.optLong("at", System.currentTimeMillis()),
                who
            );
            if (i == lines.length() - 1 && image != null) message.setData(p.optString("imageMime", "image/webp"), image);
            style.addMessage(message);
            lastName = name;
        }

        String label = group ? title : lastName;
        String shortcutId = "chat-" + channelId;
        publishShortcut(ctx, shortcutId, label, url);

        NotificationCompat.Builder b = base(ctx, CHANNEL_MESSAGES)
            .setStyle(style)
            .setLargeIcon(avatar(label))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setShortcutId(shortcutId)
            .setOnlyAlertOnce(false);

        if (p.optBoolean("canReply", true) && prefs(ctx).getString("secret", null) != null) {
            RemoteInput input = new RemoteInput.Builder(REPLY_KEY).setLabel("Escribe tu respuesta").build();
            Intent reply = new Intent(ctx, NavioActionReceiver.class).setAction(ACTION_REPLY)
                .putExtra("channelId", channelId).putExtra("notifId", id).putExtra("title", title).putExtra("group", group);
            PendingIntent replyIntent = PendingIntent.getBroadcast(ctx, id * 31 + 1, reply,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0));
            b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_navio, "Responder", replyIntent)
                .addRemoteInput(input)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build());
        }
        if (prefs(ctx).getString("secret", null) != null) {
            Intent read = new Intent(ctx, NavioActionReceiver.class).setAction(ACTION_READ).putExtra("channelId", channelId).putExtra("notifId", id);
            PendingIntent readIntent = PendingIntent.getBroadcast(ctx, id * 31 + 2, read, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_navio, "Marcar como leído", readIntent)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build());
        }
        return b;
    }

    private static NotificationCompat.Builder callBuilder(Context ctx, JSONObject p) {
        String title = p.optString("title", "Llamada de Navio");
        String body = p.optString("body", "Toca para contestar");
        String caller = p.optString("avatar", title);
        int id = idFor(p.optString("tag", ""));
        NotificationCompat.Builder b = base(ctx, CHANNEL_CALLS)
            .setContentTitle(title)
            .setContentText(body)
            .setLargeIcon(avatar(caller))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setTimeoutAfter(45_000);
        b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_navio, "Contestar", openIntent(ctx, p.optString("url", "/"), id * 31 + 3)).build());
        return b;
    }

    private static NotificationCompat.Builder simpleBuilder(Context ctx, JSONObject p) {
        String title = p.optString("title", "Navio");
        String body = p.optString("body", "");
        NotificationCompat.Builder b = base(ctx, CHANNEL_MESSAGES)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH);
        String who = p.optString("avatar", "");
        if (!who.isEmpty()) b.setLargeIcon(avatar(who));
        return b;
    }

    /** Acceso directo de la conversación: Android la muestra como "conversación". */
    private static void publishShortcut(Context ctx, String id, String label, String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(SITE + (safeUrl(url) ? url : "/")), ctx, MainActivity.class);
            intent.putExtra(MainActivity.EXTRA_URL, safeUrl(url) ? url : "/");
            Person person = new Person.Builder().setName(label).setKey(label).setIcon(IconCompat.createWithBitmap(avatar(label))).build();
            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(ctx, id)
                .setShortLabel(label.length() > 24 ? label.substring(0, 24) : label)
                .setLongLabel(label)
                .setIcon(IconCompat.createWithBitmap(avatar(label)))
                .setIntent(intent)
                .setLongLived(true)
                .setPerson(person)
                .build();
            ShortcutManagerCompat.pushDynamicShortcut(ctx, shortcut);
        } catch (Exception ignored) {
            // Sin acceso directo la notificación se ve igual.
        }
    }

    /** Descarga la vista previa (sticker o GIF pequeño) para mostrarla en el aviso. */
    private static Uri downloadImage(Context ctx, String address) {
        if (!address.startsWith("https://")) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(address).openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);
            if (conn.getResponseCode() != 200 || conn.getContentLength() > MAX_IMAGE_BYTES) return null;
            File dir = new File(ctx.getCacheDir(), "avisos");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File file = new File(dir, Integer.toHexString(address.hashCode()) + ".img");
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buf = new byte[8192];
                int total = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_IMAGE_BYTES) return null;
                    out.write(buf, 0, n);
                }
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            ctx.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return uri;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Responder o marcar como leído sin abrir Navio (función push_action). */
    static boolean sendAction(Context ctx, long channelId, String act, String body) {
        SharedPreferences prefs = prefs(ctx);
        String token = prefs.getString("token", null);
        String secret = prefs.getString("secret", null);
        String base = prefs.getString("url", null);
        String anon = prefs.getString("anon", null);
        if (token == null || secret == null || base == null || anon == null || !base.startsWith("https://")) return false;
        HttpURLConnection conn = null;
        try {
            JSONObject json = new JSONObject();
            json.put("device_kind", "android");
            json.put("device_ident", token);
            json.put("device_secret", secret);
            json.put("target_channel", channelId);
            json.put("act", act);
            if (body != null) json.put("reply_body", body);
            conn = (HttpURLConnection) new URL(base + "/rest/v1/rpc/push_action").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            conn.setRequestProperty("apikey", anon);
            conn.setRequestProperty("Authorization", "Bearer " + anon);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = conn.getOutputStream()) {
                out.write(json.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code >= 400) {
                InputStream err = conn.getErrorStream();
                if (err != null) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[1024];
                    int n;
                    while ((n = err.read(chunk)) > 0 && buf.size() < 4096) buf.write(chunk, 0, n);
                    android.util.Log.w("Navio", "push_action " + code + ": " + buf.toString("UTF-8"));
                }
            }
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Si no se pudo responder desde el aviso. */
    static void showFailure(Context ctx, int id, String text) {
        if (!canNotify(ctx)) return;
        NotificationCompat.Builder b = base(ctx, CHANNEL_MESSAGES)
            .setContentTitle("No se pudo enviar")
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(openIntent(ctx, "/?open=messages", id));
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // Sin permiso.
        }
    }
}
