package mx.navio.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

/**
 * "Agregar a WhatsApp": recibe un paquete de stickers desde Navio (imágenes ya
 * preparadas a 512×512 en WEBP y un ícono de 96×96 en PNG), lo guarda dentro
 * de la app y le pide a WhatsApp que lo agregue. WhatsApp lee los archivos a
 * través de StickerContentProvider.
 */
@CapacitorPlugin(name = "WhatsAppStickers")
public class WhatsAppStickersPlugin extends Plugin {

    private static final int MAX_STICKERS = 30;
    private static final int MIN_STICKERS = 3;

    @PluginMethod
    public void addPack(PluginCall call) {
        String identifier = call.getString("identifier", "");
        String name = call.getString("name", "Stickers de Navio");
        String publisher = call.getString("publisher", "Navio");
        String tray = call.getString("trayImage", "");
        JSArray stickers = call.getArray("stickers");

        if (!identifier.matches("[a-z0-9_]{3,40}")) {
            call.reject("Identificador de paquete no válido.");
            return;
        }
        if (stickers == null || stickers.length() < MIN_STICKERS) {
            call.reject("WhatsApp pide al menos 3 stickers por paquete.");
            return;
        }
        try {
            File dir = StickerStore.packDir(getContext(), identifier);
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();

            write(new File(dir, StickerStore.TRAY_FILE), tray);
            JSONArray files = new JSONArray();
            int count = Math.min(stickers.length(), MAX_STICKERS);
            for (int i = 0; i < count; i++) {
                String fileName = String.format("%02d.webp", i + 1);
                write(new File(dir, fileName), stickers.getString(i));
                files.put(fileName);
            }

            JSONObject pack = new JSONObject();
            pack.put("identifier", identifier);
            pack.put("name", name.length() > 128 ? name.substring(0, 128) : name);
            pack.put("publisher", publisher.length() > 128 ? publisher.substring(0, 128) : publisher);
            pack.put("files", files);
            pack.put("version", String.valueOf(System.currentTimeMillis()));
            StickerStore.savePack(getContext(), pack);
        } catch (Exception e) {
            call.reject("No se pudo preparar el paquete: " + e.getMessage());
            return;
        }

        Intent intent = new Intent();
        intent.setAction("com.whatsapp.intent.action.ENABLE_STICKER_PACK");
        intent.putExtra("sticker_pack_id", identifier);
        intent.putExtra("sticker_pack_authority", getContext().getPackageName() + StickerContentProvider.AUTHORITY_SUFFIX);
        intent.putExtra("sticker_pack_name", name);
        try {
            startActivityForResult(call, intent, "packAdded");
        } catch (ActivityNotFoundException e) {
            call.reject("WhatsApp no está instalado en este teléfono.");
        }
    }

    @ActivityCallback
    private void packAdded(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject answer = new JSObject();
        answer.put("added", result.getResultCode() == android.app.Activity.RESULT_OK);
        if (result.getData() != null && result.getData().hasExtra("validation_error")) {
            answer.put("error", result.getData().getStringExtra("validation_error"));
        }
        call.resolve(answer);
    }

    private static void write(File file, String base64) throws Exception {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (bytes.length == 0 || bytes.length > 512 * 1024) throw new IllegalArgumentException("imagen no válida");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
    }
}
