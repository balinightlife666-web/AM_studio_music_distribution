package com.amstudio.distribution.domain;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class ReleaseDraft {
    private String id;
    private String backendReleaseId;
    private String title;
    private String artistName;
    private String labelName;
    private String releaseType;
    private String versionTitle;
    private String genre;
    private String language;
    private String releaseDate;
    private String upc;
    private String catalogNumber;
    private String isrc;
    private String pLine;
    private String cLine;
    private String songwriter;
    private String composer;
    private String copyrightOwner;
    private String audioUri;
    private String audioName;
    private String audioMime;
    private long audioSizeBytes;
    private long audioDurationMs;
    private String artworkUri;
    private String artworkName;
    private String artworkMime;
    private long artworkSizeBytes;
    private int artworkWidth;
    private int artworkHeight;
    private boolean explicitContent;
    private boolean rightsConfirmed;
    private ReleaseStatus status;
    private long updatedAt;
    private final List<String> destinations;
    private final List<String> territories;

    public ReleaseDraft() {
        this.id = "rel_" + UUID.randomUUID().toString().replace("-", "");
        this.backendReleaseId = "";
        this.title = "";
        this.artistName = "";
        this.labelName = "AM STUDIO";
        this.releaseType = "SINGLE";
        this.versionTitle = "";
        this.genre = "";
        this.language = "";
        this.releaseDate = "";
        this.upc = "";
        this.catalogNumber = "";
        this.isrc = "";
        this.pLine = "";
        this.cLine = "";
        this.songwriter = "";
        this.composer = "";
        this.copyrightOwner = "";
        this.audioUri = "";
        this.audioName = "";
        this.audioMime = "";
        this.artworkUri = "";
        this.artworkName = "";
        this.artworkMime = "";
        this.status = ReleaseStatus.DRAFT;
        this.updatedAt = System.currentTimeMillis();
        this.destinations = new ArrayList<>();
        this.territories = new ArrayList<>();
        this.territories.add("WORLDWIDE");
    }

    public String getId() { return id; }
    public String getBackendReleaseId() { return backendReleaseId; }
    public String getTitle() { return title; }
    public String getArtistName() { return artistName; }
    public String getLabelName() { return labelName; }
    public String getReleaseType() { return releaseType; }
    public String getVersionTitle() { return versionTitle; }
    public String getGenre() { return genre; }
    public String getLanguage() { return language; }
    public String getReleaseDate() { return releaseDate; }
    public String getUpc() { return upc; }
    public String getCatalogNumber() { return catalogNumber; }
    public String getIsrc() { return isrc; }
    public String getPLine() { return pLine; }
    public String getCLine() { return cLine; }
    public String getSongwriter() { return songwriter; }
    public String getComposer() { return composer; }
    public String getCopyrightOwner() { return copyrightOwner; }
    public String getAudioUri() { return audioUri; }
    public String getAudioName() { return audioName; }
    public String getAudioMime() { return audioMime; }
    public long getAudioSizeBytes() { return audioSizeBytes; }
    public long getAudioDurationMs() { return audioDurationMs; }
    public String getArtworkUri() { return artworkUri; }
    public String getArtworkName() { return artworkName; }
    public String getArtworkMime() { return artworkMime; }
    public long getArtworkSizeBytes() { return artworkSizeBytes; }
    public int getArtworkWidth() { return artworkWidth; }
    public int getArtworkHeight() { return artworkHeight; }
    public boolean isExplicitContent() { return explicitContent; }
    public boolean isRightsConfirmed() { return rightsConfirmed; }
    public ReleaseStatus getStatus() { return status; }
    public long getUpdatedAt() { return updatedAt; }
    public List<String> getDestinations() { return new ArrayList<>(destinations); }
    public List<String> getTerritories() { return new ArrayList<>(territories); }

    public void setBackendReleaseId(String value) { backendReleaseId = clean(value); touch(); }
    public void setTitle(String value) { title = clean(value); touch(); }
    public void setArtistName(String value) { artistName = clean(value); touch(); }
    public void setLabelName(String value) { labelName = clean(value); touch(); }
    public void setReleaseType(String value) { releaseType = clean(value).toUpperCase(); touch(); }
    public void setVersionTitle(String value) { versionTitle = clean(value); touch(); }
    public void setGenre(String value) { genre = clean(value); touch(); }
    public void setLanguage(String value) { language = clean(value).toLowerCase(); touch(); }
    public void setReleaseDate(String value) { releaseDate = clean(value); touch(); }
    public void setUpc(String value) { upc = clean(value).replaceAll("\\D", ""); touch(); }
    public void setCatalogNumber(String value) { catalogNumber = clean(value); touch(); }
    public void setIsrc(String value) { isrc = clean(value).toUpperCase().replaceAll("[^A-Z0-9]", ""); touch(); }
    public void setPLine(String value) { pLine = clean(value); touch(); }
    public void setCLine(String value) { cLine = clean(value); touch(); }
    public void setSongwriter(String value) { songwriter = clean(value); touch(); }
    public void setComposer(String value) { composer = clean(value); touch(); }
    public void setCopyrightOwner(String value) { copyrightOwner = clean(value); touch(); }
    public void setExplicitContent(boolean value) { explicitContent = value; touch(); }
    public void setRightsConfirmed(boolean value) { rightsConfirmed = value; touch(); }
    public void setStatus(ReleaseStatus value) { status = value == null ? ReleaseStatus.DRAFT : value; touch(); }

    public void setAudio(String uri, String name, String mime, long sizeBytes, long durationMs) {
        audioUri = clean(uri);
        audioName = clean(name);
        audioMime = clean(mime);
        audioSizeBytes = Math.max(0L, sizeBytes);
        audioDurationMs = Math.max(0L, durationMs);
        touch();
    }

    public void setArtwork(String uri, String name, String mime, long sizeBytes, int width, int height) {
        artworkUri = clean(uri);
        artworkName = clean(name);
        artworkMime = clean(mime);
        artworkSizeBytes = Math.max(0L, sizeBytes);
        artworkWidth = Math.max(0, width);
        artworkHeight = Math.max(0, height);
        touch();
    }

    public void setDestinations(List<String> values) {
        destinations.clear();
        if (values != null) {
            for (String value : values) {
                String clean = clean(value);
                if (!clean.isEmpty() && !destinations.contains(clean)) destinations.add(clean);
            }
        }
        touch();
    }

    public void setTerritories(List<String> values) {
        territories.clear();
        if (values != null) {
            for (String value : values) {
                String normalized = clean(value).toUpperCase();
                if (!normalized.isEmpty() && !territories.contains(normalized)) territories.add(normalized);
            }
        }
        if (territories.isEmpty()) territories.add("WORLDWIDE");
        touch();
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("backendReleaseId", backendReleaseId);
        json.put("title", title);
        json.put("artistName", artistName);
        json.put("labelName", labelName);
        json.put("releaseType", releaseType);
        json.put("versionTitle", versionTitle);
        json.put("genre", genre);
        json.put("language", language);
        json.put("releaseDate", releaseDate);
        json.put("upc", upc);
        json.put("catalogNumber", catalogNumber);
        json.put("isrc", isrc);
        json.put("pLine", pLine);
        json.put("cLine", cLine);
        json.put("songwriter", songwriter);
        json.put("composer", composer);
        json.put("copyrightOwner", copyrightOwner);
        json.put("audioUri", audioUri);
        json.put("audioName", audioName);
        json.put("audioMime", audioMime);
        json.put("audioSizeBytes", audioSizeBytes);
        json.put("audioDurationMs", audioDurationMs);
        json.put("artworkUri", artworkUri);
        json.put("artworkName", artworkName);
        json.put("artworkMime", artworkMime);
        json.put("artworkSizeBytes", artworkSizeBytes);
        json.put("artworkWidth", artworkWidth);
        json.put("artworkHeight", artworkHeight);
        json.put("explicitContent", explicitContent);
        json.put("rightsConfirmed", rightsConfirmed);
        json.put("status", status.name());
        json.put("updatedAt", updatedAt);
        JSONArray stores = new JSONArray();
        for (String destination : destinations) stores.put(destination);
        json.put("destinations", stores);
        JSONArray territoryRows = new JSONArray();
        for (String territory : territories) territoryRows.put(territory);
        json.put("territories", territoryRows);
        return json;
    }

    public static ReleaseDraft fromJson(JSONObject json) {
        ReleaseDraft draft = new ReleaseDraft();
        if (json == null) return draft;
        draft.id = json.optString("id", draft.id);
        draft.backendReleaseId = json.optString("backendReleaseId", "");
        draft.title = json.optString("title", "");
        draft.artistName = json.optString("artistName", "");
        draft.labelName = json.optString("labelName", "AM STUDIO");
        draft.releaseType = json.optString("releaseType", "SINGLE").toUpperCase();
        draft.versionTitle = json.optString("versionTitle", "");
        draft.genre = json.optString("genre", "");
        draft.language = json.optString("language", "");
        draft.releaseDate = json.optString("releaseDate", "");
        draft.upc = json.optString("upc", "");
        draft.catalogNumber = json.optString("catalogNumber", "");
        draft.isrc = json.optString("isrc", "");
        draft.pLine = json.optString("pLine", "");
        draft.cLine = json.optString("cLine", "");
        draft.songwriter = json.optString("songwriter", "");
        draft.composer = json.optString("composer", "");
        draft.copyrightOwner = json.optString("copyrightOwner", "");
        draft.audioUri = json.optString("audioUri", "");
        draft.audioName = json.optString("audioName", "");
        draft.audioMime = json.optString("audioMime", "");
        draft.audioSizeBytes = json.optLong("audioSizeBytes", 0L);
        draft.audioDurationMs = json.optLong("audioDurationMs", 0L);
        draft.artworkUri = json.optString("artworkUri", "");
        draft.artworkName = json.optString("artworkName", "");
        draft.artworkMime = json.optString("artworkMime", "");
        draft.artworkSizeBytes = json.optLong("artworkSizeBytes", 0L);
        draft.artworkWidth = json.optInt("artworkWidth", 0);
        draft.artworkHeight = json.optInt("artworkHeight", 0);
        draft.explicitContent = json.optBoolean("explicitContent", false);
        draft.rightsConfirmed = json.optBoolean("rightsConfirmed", false);
        draft.status = ReleaseStatus.safeValueOf(json.optString("status", "DRAFT"));
        draft.updatedAt = json.optLong("updatedAt", System.currentTimeMillis());
        draft.destinations.clear();
        JSONArray stores = json.optJSONArray("destinations");
        if (stores != null) {
            for (int i = 0; i < stores.length(); i++) {
                String value = clean(stores.optString(i, ""));
                if (!value.isEmpty()) draft.destinations.add(value);
            }
        }
        draft.territories.clear();
        JSONArray territoryRows = json.optJSONArray("territories");
        if (territoryRows != null) {
            for (int i = 0; i < territoryRows.length(); i++) {
                String value = clean(territoryRows.optString(i, "")).toUpperCase();
                if (!value.isEmpty() && !draft.territories.contains(value)) draft.territories.add(value);
            }
        }
        if (draft.territories.isEmpty()) draft.territories.add("WORLDWIDE");
        return draft;
    }

    private void touch() { updatedAt = System.currentTimeMillis(); }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
}
