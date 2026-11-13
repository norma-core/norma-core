/* Frama-C stand-in for the Bosch host interface. Contracts only, no bodies:
   every function may fail, and whatever it writes into a caller buffer is
   arbitrary. Proofs therefore hold for any hub behaviour, including corrupt
   status entries. */
#ifndef WP_BHY2_HIF_H
#define WP_BHY2_HIF_H
#include "bhy2_defs.h"

/*@ requires \valid(hif) && \valid(reg_data + (0 .. length - 1));
    assigns reg_data[0 .. length - 1]; */
int8_t bhy2_hif_get_regs(uint8_t reg_addr, uint8_t *reg_data, uint32_t length, struct bhy2_hif_dev *hif);

/*@ requires \valid_read(hif);
    assigns \nothing; */
int8_t bhy2_hif_delay_us(uint32_t period_us, const struct bhy2_hif_dev *hif);

/*@ requires \valid(hif);
    requires length == 0 || \valid_read(payload + (0 .. length - 1));
    assigns \nothing; */
int8_t bhy2_hif_exec_cmd(uint16_t cmd, const uint8_t *payload, uint32_t length, struct bhy2_hif_dev *hif);

/*@ requires \valid(hif) && \valid(int_status);
    assigns *int_status; */
int8_t bhy2_hif_get_interrupt_status(uint8_t *int_status, struct bhy2_hif_dev *hif);

/*@ requires \valid(hif) && \valid(kernel_version);
    assigns *kernel_version; */
int8_t bhy2_hif_get_kernel_version(uint16_t *kernel_version, struct bhy2_hif_dev *hif);

/*@ requires \valid(hif) && \valid_read(bsx_state + (0 .. state_len - 1));
    assigns \nothing; */
int8_t bhy2_hif_set_bsx_state(uint16_t param_id, const uint8_t *bsx_state, uint32_t state_len, struct bhy2_hif_dev *hif);
#endif
