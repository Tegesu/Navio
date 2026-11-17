package mx.navio.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.UriMatcher;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * Lo que WhatsApp consulta para agregar un paquete de stickers de Navio (el
 * contrato de su ejemplo oficial). Solo WhatsApp puede leerlo: el proveedor
 * pide el permiso com.whatsapp.sticker.READ.
 */
public class StickerContentProvider extends ContentProvider {

    static final String AUTHORITY_SUFFIX = ".stickercontentprovider";

    private static final int METADATA_ALL = 1;
    private static final int METADATA_ONE = 2;
    private static final int STICKERS = 3;
    private static final int ASSET = 4;

    private UriMatcher matcher;
    private String authority;

    @Override
    public boolean onCreate() {
        authority = getContext().getPackageName() + AUTHORITY_SUFFIX;
        matcher = new UriMatcher(UriMatcher.NO_MATCH);
        matcher.addURI(authority, "metadata", METADATA_ALL);
        matcher.addURI(authority, "metadata/*", METADATA_ONE);
        matcher.addURI(authority, "stickers/*", STICKERS);
        matcher.addURI(authority, "stickers_asset/*/*", ASSET);
        return true;
    }

    private static final String[] PACK_COLUMNS = {
        "sticker_pack_identifier", "sticker_pack_name", "sticker_pack_publisher", "sticker_pack_icon",
        "android_play_store_link", "ios_app_download_link", "sticker_pack_publisher_email",
        "sticker_pack_publisher_website", "sticker_pack_privacy_policy_website",
        "sticker_pack_license_agreement_website", "image_data_version", "whatsapp_will_not_cache_stickers",
        "animated_sticker_pack"
    };

    private void addPackRow(MatrixCursor cursor, JSONObject pack) {
        cursor.addRow(new Object[] {
            pack.optString("identifier"), pack.optString("name"), pack.optString("publisher"), StickerStore.TRAY_FILE,
            "", "", "", "https://navio-fyj2.vercel.app", "https://navio-fyj2.vercel.app", "",
            pack.optString("version", "1"), 0, 0
        });
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        int match = matcher.match(uri);
        if (match == METADATA_ALL) {
            MatrixCursor cursor = new MatrixCursor(PACK_COLUMNS);
            JSONArray packs = StickerStore.packs(getContext());
            for (int i = 0; i < packs.length(); i++) {
                JSONObject p = packs.optJSONObject(i);
                if (p != null) addPackRow(cursor, p);
            }
            return cursor;
        }
        if (match == METADATA_ONE) {
            MatrixCursor cursor = new MatrixCursor(PACK_COLUMNS);
            JSONObject p = StickerStore.pack(getContext(), uri.getLastPathSegment());
            if (p != null) addPackRow(cursor, p);
            return cursor;
        }
        if (match == STICKERS) {
            MatrixCursor cursor = new MatrixCursor(new String[] { "sticker_file_name", "sticker_emoji", "sticker_accessibility_text" });
            JSONObject p = StickerStore.pack(getContext(), uri.getLastPathSegment());
            if (p != null) {
                JSONArray files = p.optJSONArray("files");
                for (int i = 0; files != null && i < files.length(); i++) {
                    cursor.addRow(new Object[] { files.optString(i), "😀", "Sticker de Navio" });
                }
            }
            return cursor;
        }
        throw new IllegalArgumentException("URI desconocida: " + uri);
    }

    @Override
    public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        if (matcher.match(uri) != ASSET) throw new FileNotFoundException(uri.toString());
        List<String> segments = uri.getPathSegments();
        String identifier = segments.get(segments.size() - 2);
        String fileName = segments.get(segments.size() - 1);
        // Solo nombres simples dentro de la carpeta del paquete.
        if (!identifier.matches("[a-z0-9_]{3,40}") || !fileName.matches("[0-9]{2}\\.webp|tray\\.png")) {
            throw new FileNotFoundException(uri.toString());
        }
        File file = new File(StickerStore.packDir(getContext(), identifier), fileName);
        if (!file.exists()) throw new FileNotFoundException(uri.toString());
        return new AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, AssetFileDescriptor.UNKNOWN_LENGTH);
    }

    @Override
    public String getType(Uri uri) {
        int match = matcher.match(uri);
        if (match == METADATA_ALL) return "vnd.android.cursor.dir/vnd." + authority + ".metadata";
        if (match == METADATA_ONE) return "vnd.android.cursor.item/vnd." + authority + ".metadata";
        if (match == STICKERS) return "vnd.android.cursor.dir/vnd." + authority + ".stickers";
        if (match == ASSET) return uri.getLastPathSegment().endsWith(".png") ? "image/png" : "image/webp";
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
