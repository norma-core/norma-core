/* Frama-C stand-in for Arduino_BHY2/src/bosch/bhy2_defs.h: only what the
   firmware uses, with the library's values. */
#ifndef WP_BHY2_DEFS_H
#define WP_BHY2_DEFS_H
#include <stdint.h>

#define BHY2_OK INT8_C(0)
#define BHY2_E_INVALID_PARAM INT8_C(-2)
#define BHY2_E_TIMEOUT INT8_C(-5)
#define BHY2_E_BUFFER INT8_C(-6)

#define BHY2_REG_CHAN_STATUS UINT8_C(0x03)
#define BHY2_IST_MASK_STATUS (0x20)
#define BHY2_PARAM_READ_MASK UINT16_C(0x1000)
#define BHY2_PARAM_SENSOR_CONF_0 UINT16_C(0x500)
#define BHY2_BSX_STATE_TRANSFER_COMPLETE UINT8_C(128)
#define BHY2_BSX_STATE_BLOCK_LEN UINT8_C(64)
#define BHY2_BSX_STATE_STRUCT_LEN UINT8_C(68)
#define BHY2_LE2U16(x) ((uint16_t)((x)[0] | (x)[1] << 8))

struct bhy2_hif_dev { int opaque; };
struct bhy2_dev { struct bhy2_hif_dev hif; };
#endif
