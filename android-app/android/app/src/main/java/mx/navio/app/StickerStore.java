package mx.navio.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Dónde guarda Navio los paquetes de stickers que pasan a WhatsApp. */
final class StickerStore {

    static final String TRAY_FILE = "tray.png";
    private static final String INDEX_FILE = "packs.json";

    private StickerStore() {}

    static File root(Context context) {
        File dir = new File(context.getFilesDir(), "stickers");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    static File packDir(Context context, String identifier) {
        File dir = new File(root(context), identifier);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    static synchronized JSONArray packs(Context context) {
        File index = new File(root(context), INDEX_FILE);
        if (!index.exists()) return new JSONArray();
        try (FileInputStream in = new FileInputStream(index)) {
            byte[] data = new byte[(int) index.length()];
            int read = in.read(data);
            return new JSONArray(new String(data, 0, Math.max(read, 0), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static JSONObject pack(Context context, String identifier) {
        JSONArray all = packs(context);
        for (int i = 0; i < all.length(); i++) {
            JSONObject p = all.optJSONObject(i);
            if (p != null && identifier.equals(p.optString("identifier"))) return p;
        }
        return null;
    }

    static synchronized void savePack(Context context, JSONObject pack) throws Exception {
        JSONArray all = packs(context);
        JSONArray next = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject p = all.optJSONObject(i);
            if (p != null && !pack.getString("identifier").equals(p.optString("identifier"))) next.put(p);
        }
        next.put(pack);
        try (FileOutputStream out = new FileOutputStream(new File(root(context), INDEX_FILE))) {
            out.write(next.toString().getBytes(StandardCharsets.UTF_8));
        }
    }
}
