// No <stdbool.h> here on purpose: doomstat.h reaches doomtype.h, which declares
// `enum { false, true } boolean`, and that does not compile once stdbool.h has
// turned those two names into macros. Nothing in this file used bool anyway.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "doomgeneric.h"
#include "doomkeys.h"
#include "doomreplay.h"
#include "doomstat.h"
#include "dr_font.h"
#include "i_timer.h"

#define KEYQUEUE_SIZE 16

static unsigned short s_KeyQueue[KEYQUEUE_SIZE];
static unsigned int s_KeyQueueWriteIndex = 0;
static unsigned int s_KeyQueueReadIndex = 0;

static FILE* g_fp = NULL;

static clock_t g_t_start = 0;

static const int64_t g_dt = 35000;
static const int64_t g_dt_gs =
    (g_dt / 5) / TICRATE;  // ensure at least 5 updates per frame

static int64_t g_time_gs = 0;      // current time
static int32_t g_frame_id = 0;     // frame index
static int32_t g_username_id = 0;  // username index

static dr_keys_t g_pressed_last;
static dr_keys_t g_key_map;
static replay_data_t g_replay_data;

static void renderText(uint32_t* screen, const char* text, int xoffs, int yoffs,
                       int ecol) {
    int n = strlen(text);
    if (n) {
        uint32_t col = 0x0000FF00;
        for (int i = 0; i < n; ++i) {
            for (int y = 0; y < FONT_SIZE_Y; ++y) {
                for (int x = 0; x < FONT_SIZE_X; ++x) {
                    col = kFontRaster[(int)text[i]][y * FONT_SIZE_X + x];
                    if (col) {
                        if (ecol == 0) col = col << 8;  // green
                        if (ecol == 1)
                            col = (((29 * col) / 255) << 16) |
                                  (((161 * col) / 255) << 8) |
                                  ((242 * col) / 255);  // blue
                        screen[(yoffs + y) * DOOMGENERIC_RESX +
                               (i * FONT_SIZE_X + xoffs + x)] = col;
                    }
                }
            }
        }
    }
}

static void addConvertedKeyToQueue(int pressed, unsigned char key) {
    unsigned short keyData = (pressed << 8) | key;

    s_KeyQueue[s_KeyQueueWriteIndex] = keyData;
    s_KeyQueueWriteIndex++;
    s_KeyQueueWriteIndex %= KEYQUEUE_SIZE;
}

void DR_Init(replay_data_t replay_data) {
    g_key_map[dr_key_escape] = KEY_ESCAPE;
    g_key_map[dr_key_enter] = KEY_ENTER;
    g_key_map[dr_key_left] = KEY_LEFTARROW;
    g_key_map[dr_key_right] = KEY_RIGHTARROW;
    g_key_map[dr_key_up] = KEY_UPARROW;
    g_key_map[dr_key_down] = KEY_DOWNARROW;
    g_key_map[dr_key_alt] = KEY_LALT;
    g_key_map[dr_key_shift] = KEY_RSHIFT;
    g_key_map[dr_key_use] = KEY_USE;
    g_key_map[dr_key_fire] = KEY_FIRE;
    g_key_map[dr_key_tab] = KEY_TAB;
    g_key_map[dr_key_yes] = 'y';
    g_key_map[dr_key_no] = 'n';
    g_key_map[dr_key_strafe_left] = KEY_STRAFE_L;
    g_key_map[dr_key_strafe_right] = KEY_STRAFE_R;
    g_key_map[dr_key_0] = '0';
    g_key_map[dr_key_1] = '1';
    g_key_map[dr_key_2] = '2';
    g_key_map[dr_key_3] = '3';
    g_key_map[dr_key_4] = '4';
    g_key_map[dr_key_5] = '5';
    g_key_map[dr_key_6] = '6';
    g_key_map[dr_key_7] = '7';
    g_key_map[dr_key_8] = '8';
    g_key_map[dr_key_9] = '9';

    g_replay_data = replay_data;

    for (int i = 0; i < dr_key_COUNT; ++i) {
        g_pressed_last[i] = 0;
    }

    printf("\n\n======= DOOM REPLAY ===========\n");
    printf("Frames to simulate: %6d (%g seconds)\n", g_replay_data.n_frames,
           (float)(g_replay_data.n_frames) / TICRATE);
    printf("Start frame:        %6d (%g seconds)\n", g_replay_data.n_start,
           (float)(g_replay_data.n_start) / TICRATE);
    printf("Frames to record:   %6d (%g seconds)\n", g_replay_data.n_record,
           (float)(g_replay_data.n_record) / TICRATE);
    printf("Framerate:          %6d\n", g_replay_data.framerate);
    printf("Usernames:          %6d\n", g_replay_data.n_usernames);
    printf("Render frame idx:   %6d\n", g_replay_data.render_frame);
    printf("Render input:       %6d\n", g_replay_data.render_input);
    printf("Render username:    %6d\n", g_replay_data.render_username);
    printf("===============================\n");
}

void DR_ProcessInput() {
    if (g_frame_id < g_replay_data.n_start + g_replay_data.n_record &&
        g_frame_id < g_replay_data.n_frames) {
        for (int i = 0; i < dr_key_COUNT; ++i) {
            if (g_replay_data.frames[g_frame_id].pressed[i] !=
                g_pressed_last[i]) {
                int pressed = g_pressed_last[i] ? 0 : 1;
                addConvertedKeyToQueue(pressed, g_key_map[i]);
            } else {
                int pressed = g_replay_data.frames[g_frame_id].pressed[i];
                if (pressed) addConvertedKeyToQueue(pressed, g_key_map[i]);
            }
        }

        memcpy(g_pressed_last, g_replay_data.frames[g_frame_id].pressed,
               sizeof(dr_keys_t));
    }
}

int DR_NeedRender(int f) { return g_frame_id >= g_replay_data.n_start - f; }

void DR_UpdateTime() { g_time_gs += g_dt_gs; }

void DG_Init() {}

// play-doom: the output-side ffmpeg arguments used to be hardcoded here, which put
// the encoder settings out of reach of the API driving this binary. They are now
// overridable per container via the environment. The defaults below are the exact
// strings this file used before, so an unset environment behaves as it always did.
//
// Returns the arguments that sit between ffmpeg's `-i -` and the output path, or
// NULL for an extension with no encoder. Overriding these is how play-doom gets a
// two-pass palette gif instead of the fixed-palette `-pix_fmt bgr8` one.
static const char* dr_encoder_args(const char* ext) {
    const char* env = NULL;

    if (strcmp(ext, "mp4") == 0) {
        env = getenv("DR_FFMPEG_ARGS_MP4");
        return (env && *env) ? env : "-vcodec h264 -pix_fmt yuv420p -threads 1";
    }
    if (strcmp(ext, "gif") == 0) {
        env = getenv("DR_FFMPEG_ARGS_GIF");
        return (env && *env) ? env : "-pix_fmt bgr8 -threads 1 -loop -1";
    }
    if (strcmp(ext, "png") == 0) {
        env = getenv("DR_FFMPEG_ARGS_PNG");
        return (env && *env) ? env : "-pix_fmt rgb24 -threads 1";
    }
    return NULL;
}

void DG_DrawFrame() {
    if (DR_NeedRender(0)) {
        if (g_fp == NULL) {
            // play-doom: 4096, not 1024 — a two-pass palette filtergraph plus an
            // absolute output path does not fit in the original buffer.
            char ffmpegCommandLine[4096];

            const char* encoderArgs = dr_encoder_args(g_replay_data.fname_ext);

            // play-doom: previously an unrecognised extension left this buffer
            // uninitialised and handed it straight to popen.
            if (encoderArgs == NULL) {
                fprintf(stderr, "Unsupported output extension '%s'\n",
                        g_replay_data.fname_ext);
                exit(1);
            }

            const char* ffmpegBin = getenv("DR_FFMPEG_BIN");
            if (ffmpegBin == NULL || *ffmpegBin == '\0') ffmpegBin = "ffmpeg";

            // The output path is quoted because it is caller-supplied and this
            // whole string is handed to a shell by popen.
            int written = snprintf(ffmpegCommandLine, sizeof(ffmpegCommandLine),
                                   "%s"
                                   " -nostats "
                                   " -y -f rawvideo -framerate %d"
                                   " -s %dx%d"
                                   " -pix_fmt bgra -vcodec rawvideo -i -"
                                   " %s"
                                   " \"%s\"",
                                   ffmpegBin, g_replay_data.framerate,
                                   DOOMGENERIC_RESX, DOOMGENERIC_RESY,
                                   encoderArgs, g_replay_data.fname_output);

            // play-doom: snprintf truncates silently, which would have produced a
            // valid-looking ffmpeg command writing to a truncated path.
            if (written < 0 || written >= (int)sizeof(ffmpegCommandLine)) {
                fprintf(stderr, "ffmpeg command line too long (%d bytes)\n",
                        written);
                exit(1);
            }

            printf("Starting ffmpeg process: '%s'\n", ffmpegCommandLine);
#ifdef _WIN32
            const char* popenType = "wb";
#else
            const char* popenType = "w";
#endif
            g_fp = popen(ffmpegCommandLine, popenType);

            if (g_fp == NULL) {
                fprintf(stderr, "Failed to start ffmpeg\n");
                exit(1);
            }
        }
        if (g_fp) {
            // play-doom: was char[32]. "F:<frame> I:" is already 8-12 bytes and the
            // block below strcat's one byte per held key, of which there are 25 —
            // a frame with enough keys down overran the buffer.
            char t[64];
            t[0] = 0;
            if (g_replay_data.render_frame) {
                snprintf(t, sizeof(t), "F:%d I:", g_frame_id);
            }
            if (g_replay_data.render_input) {
                unsigned char* pressed =
                    g_replay_data.frames[g_frame_id].pressed;
                if (pressed[dr_key_escape]) strcat(t, "x");
                if (pressed[dr_key_enter]) strcat(t, "e");
                if (pressed[dr_key_left]) strcat(t, "l");
                if (pressed[dr_key_right]) strcat(t, "r");
                if (pressed[dr_key_up]) strcat(t, "u");
                if (pressed[dr_key_down]) strcat(t, "d");
                if (pressed[dr_key_alt]) strcat(t, "a");
                if (pressed[dr_key_shift]) strcat(t, "s");
                if (pressed[dr_key_use]) strcat(t, "p");
                if (pressed[dr_key_fire]) strcat(t, "f");
                if (pressed[dr_key_tab]) strcat(t, "t");
                if (pressed[dr_key_yes]) strcat(t, "y");
                if (pressed[dr_key_no]) strcat(t, "n");
                if (pressed[dr_key_strafe_left]) strcat(t, "j");
                if (pressed[dr_key_strafe_right]) strcat(t, "k");
                if (pressed[dr_key_0]) strcat(t, "0");
                if (pressed[dr_key_1]) strcat(t, "1");
                if (pressed[dr_key_2]) strcat(t, "2");
                if (pressed[dr_key_3]) strcat(t, "3");
                if (pressed[dr_key_4]) strcat(t, "4");
                if (pressed[dr_key_5]) strcat(t, "5");
                if (pressed[dr_key_6]) strcat(t, "6");
                if (pressed[dr_key_7]) strcat(t, "7");
                if (pressed[dr_key_8]) strcat(t, "8");
                if (pressed[dr_key_9]) strcat(t, "9");
            }

            renderText(DG_ScreenBuffer, t, 2, 12, 0);

            // play-doom: the status bar already reports health, ammo, armour and
            // weapons, so this adds only what is otherwise invisible in a frame —
            // which level, how long the run has been going, and how much of the
            // map has been cleared. Gated on GS_LEVEL because these globals hold
            // the previous level's values while a menu or the title screen is up.
            if (g_replay_data.render_status && gamestate == GS_LEVEL) {
                const player_t* plyr = &players[consoleplayer];
                const int secs = leveltime / TICRATE;
                char s[64];

                snprintf(s, sizeof(s), "E%dM%d %d:%02d", gameepisode, gamemap,
                         secs / 60, secs % 60);
                renderText(DG_ScreenBuffer, s, 2, 12 + FONT_SIZE_Y, 0);

                snprintf(s, sizeof(s), "K %d/%d I %d/%d S %d/%d", plyr->killcount,
                         totalkills, plyr->itemcount, totalitems,
                         plyr->secretcount, totalsecret);
                renderText(DG_ScreenBuffer, s, 2, 12 + 2 * FONT_SIZE_Y, 0);
            }

            if (g_replay_data.render_username) {
                while (
                    g_username_id < g_replay_data.n_usernames - 1 &&
                    g_frame_id >=
                        g_replay_data.usernames[g_username_id + 1].frame_start)
                    ++g_username_id;
                renderText(
                    DG_ScreenBuffer, g_replay_data.usernames[g_username_id].buf,
                    DOOMGENERIC_RESX -
                        strlen(g_replay_data.usernames[g_username_id].buf) *
                            FONT_SIZE_X -
                        2,
                    0, 1);
            }

            if ((g_frame_id % g_replay_data.nthframe) == 0) {
                fwrite((char*)DG_ScreenBuffer,
                       4 * DOOMGENERIC_RESX * DOOMGENERIC_RESY, 1, g_fp);
            }
        }
    }

    // printf("frame = %d\n", g_frame_id);
    // printf("frame = %d, time = %d, x = %d, diff = %d\n",
    //        g_frame_id, g_time_gs/(g_dt/1000), g_time_gs/g_dt_gs,
    //        g_time_gs/g_dt_gs - g_frame_id);

    if (g_frame_id == 0) {
        g_t_start = clock();
    }

    g_frame_id++;

    if (g_frame_id >= g_replay_data.n_start + g_replay_data.n_record ||
        g_frame_id >= g_replay_data.n_frames) {
        printf("Writing %d freeze frames ..\n", g_replay_data.n_freeze);
        for (int i = 0; i < g_replay_data.n_freeze; ++i) {
            fwrite((char*)DG_ScreenBuffer,
                   4 * DOOMGENERIC_RESX * DOOMGENERIC_RESY, 1, g_fp);
        }
        if (g_fp) {
            pclose(g_fp);
            g_fp = NULL;
        }
        printf("Terminating ..\n");
        exit(0);
    }

    const int n_frames_stats = 1000;
    if (g_frame_id % n_frames_stats == 0) {
        printf("frame = %d, speed = %.2f frames/sec\n", g_frame_id,
               n_frames_stats /
                   (((double)(clock() - g_t_start)) / CLOCKS_PER_SEC));
        g_t_start = clock();
    }
}

void DG_SleepMs(uint32_t ms) {
    // noop
}

uint32_t DG_GetTicksMs() { return g_time_gs / (g_dt / 1000); }

int DG_GetKey(int* pressed, unsigned char* doomKey) {
    if (s_KeyQueueReadIndex == s_KeyQueueWriteIndex) {
        // key queue is empty
        return 0;
    } else {
        unsigned short keyData = s_KeyQueue[s_KeyQueueReadIndex];
        s_KeyQueueReadIndex++;
        s_KeyQueueReadIndex %= KEYQUEUE_SIZE;

        *pressed = keyData >> 8;
        *doomKey = keyData & 0xFF;

        return 1;
    }

    return 0;
}

void DG_SetWindowTitle(const char* title) {}
