#include <stdlib.h>
#include <stdint.h>
#include <lame/lame.h>

#define WASM_EXPORT __attribute__((visibility("default")))
#define MAX_SAMPLES 16384
#define BUF_SIZE (MAX_SAMPLES * 1.25 + 7200)

typedef struct {
  // Public fields.
  float *pcm_l;
  uint8_t *mp3;
  uint32_t size;
  // Private fields. Should not be touched by API user.
  uint32_t max_size;
  lame_global_flags *gfp;
} vmsg;

void vmsg_free(vmsg *v);

WASM_EXPORT
vmsg *vmsg_init(void) {
  vmsg *v = calloc(1, sizeof (vmsg));
  if (!v)
    goto err;

  v->size = 0;
  // NOTE(Kagami): Must be >= BUF_SIZE.
  // Reserve 1MB for encoded data initially.
  v->max_size = 1024 * 1024;
  v->mp3 = malloc(v->max_size);
  if (!v->mp3)
    goto err;

  v->pcm_l = malloc(MAX_SAMPLES * sizeof(float));
  if (!v->pcm_l)
    goto err;

  v->gfp = lame_init();
  if (!v->gfp)
    goto err;

  lame_set_mode(v->gfp, MONO);
  lame_set_num_channels(v->gfp, 1);
  lame_set_VBR(v->gfp, vbr_default);
  lame_set_VBR_quality(v->gfp, 5);

  if (lame_init_params(v->gfp) < 0)
    goto err;

  return v;
err:
  vmsg_free(v);
  return NULL;
}

static int fix_mp3_size(vmsg *v) {
  if (v->size + BUF_SIZE > v->max_size) {
    v->max_size *= 2;
    v->mp3 = realloc(v->mp3, v->max_size);
    if (!v->mp3)
      return -1;
  }
  return 0;
}

WASM_EXPORT
int vmsg_encode(vmsg *v, int nsamples) {
  if (nsamples > MAX_SAMPLES)
    return -1;

  if (fix_mp3_size(v) < 0)
    return -1;

  uint8_t *buf = v->mp3 + v->size;
  int n = lame_encode_buffer_ieee_float(
      v->gfp, v->pcm_l, NULL, nsamples, buf, BUF_SIZE);
  if (n < 0)
    return n;

  v->size += n;
  return 0;
}

WASM_EXPORT
int vmsg_flush(vmsg *v) {
  if (fix_mp3_size(v) < 0)
    return -1;

  uint8_t *buf = v->mp3 + v->size;
  int n = lame_encode_flush(v->gfp, buf, BUF_SIZE);
  if (n < 0)
    return -1;
  v->size += n;

  n = lame_get_lametag_frame(v->gfp, v->mp3, BUF_SIZE);
  if (n < 0)
    return -1;

  return 0;
}

WASM_EXPORT
void vmsg_free(vmsg *v) {
  if (v) {
    lame_close(v->gfp);
    free(v->pcm_l);
    free(v->mp3);
    free(v);
  }
}
