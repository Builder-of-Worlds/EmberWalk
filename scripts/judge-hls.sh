#!/bin/sh
# Usage: sh scripts/judge-hls.sh OUT_FOLDER <ffmpeg input arguments>, for example -framerate 30 -i frames/frame-%05d.png
set -eu
OUT=$1
shift
mkdir -p "$OUT/0" "$OUT/1"
ffmpeg -y -v error "$@" -map 0:v -map 0:v \
  -c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
  -b:v:0 14M -maxrate:v:0 18M -bufsize:v:0 28M \
  -b:v:1 6M -maxrate:v:1 8M -bufsize:v:1 12M \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments \
  -hls_fmp4_init_filename init.mp4 -master_pl_name master.m3u8 -var_stream_map "v:0 v:1" \
  -hls_segment_filename "$OUT/%v/seg%03d.m4s" "$OUT/%v/index.m3u8"
