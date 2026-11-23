#pragma once
#include <cstdint>
#include <string>

// 5 x ST3215 on the Feetech bus (UART1 through the Seeed driver board), ported from firmware/espcam main.cpp:
// the same joint table, signs, limits and 2048 = init pose; torque on takes over the pose the arm is in (no jump);
// boot never moves a servo; "set this pose as init" writes the servo's own correction register; keyframe actions
// with their light cues. A motion task runs the actions, pushes slider targets (50 Hz) and polls the servos (10 Hz).
namespace servo {
struct Joint {
    const char* name;
    uint8_t id;
    bool online, ok;      // answered the ping at boot; last status read was good
    float target, deg;    // commanded and measured angle (URDF degrees)
    int16_t ticks, load;
    uint8_t temp;
    float volt;
    int mA;
    float lo, hi;
};
static const int NJ = 5;
bool begin();                                   // bus, ping, read; restores the torque switch from flash
Joint joint(int j);                             // snapshot
int jointIndex(const char* name);               // -1 if unknown
bool torque();
void setTorque(bool on);                        // on: no-jump takeover; off: off where it is in a safe pose, else the default pose (desk) first. Saved to flash
int speed();
int acc();
void setSpeedAcc(int sp, int ac);               // -1 = keep
bool setPose(const float* q, const bool* has);  // the joints in `has`; false when the shade would hit the desk
bool floorBlocked();
const char* action();                           // running action name, "" when idle
bool startAction(const char* name);             // "" or nullptr stops the running one; a gesture ends with the "desk" action (DEFAULT_POSE)
int actionCount();
const char* actionName(int i);
bool actionSafe(int i);                         // a safe pose (0.35): the arm stands by itself there with the motors off
void actionPose(int i, float* q);               // the first keyframe's angles (NJ, NaN = joint left as it is)
bool inSafePose();                              // the arm stands in a safe pose now (target and servo); torque off then switches off where it is
// Hold test (0.32): does the pose the arm is in stand by itself without power? Motors off where the arm is, every
// joint read at 50 Hz, motors back on (no-jump takeover) as soon as one drifts more than maxDeg or when the time is
// up. The load register with the motors on says how hard a servo works, not whether its gearbox holds unpowered.
struct Hold { bool running, done; int tripped; float drift[NJ]; uint32_t ms, wantMs; float maxDeg; };   // tripped: joint index, -1 = time up (held), -2 = cancelled by a torque switch
bool holdTest(float maxDeg, uint32_t ms);       // false: see holdRefusal(). maxDeg is capped at HOLD_MAX_DEG
const char* holdRefusal();                      // why the last holdTest said no: motors off, a gesture or a test running, the shade too close to the desk, or the shoulder load above HOLD_MAX_LOAD (the pose would fall)
Hold hold();                                    // the running or last test
bool calibrate(int j);                          // make the servo read 2048 where it is now (EEPROM)
std::string lastMsg();                          // one-line result of the last calibration, cleared when read
}
