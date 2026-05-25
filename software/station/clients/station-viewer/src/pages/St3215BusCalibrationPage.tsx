import React, { useEffect, useState } from 'react';
import { st3215, motors_mirroring } from '../api/proto';
import BusWebGLRenderer from '../st3215/BusWebGLRenderer';
import MotorDataTable from '../st3215/MotorDataTable';
import webSocketManager from '../api/websocket';
import { useInferenceState, useWakeLock } from '../hooks';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { getMotorVoltage } from '../st3215/motor-parser';
import { supportsSt3215Device } from '@/devices/registry';

const MIN_CALIBRATED_RANGE = 100;
const actionButtonClasses = 'inline-flex w-full shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto md:px-6 md:py-3 md:text-base';
const wideActionButtonClasses = `${actionButtonClasses} sm:min-w-[13.5rem]`;

function ButtonLoadingLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-primary/30 border-t-text-primary" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

const St3215BusCalibrationPage: React.FC = () => {
  useWakeLock();
  
  // Add custom animation for Auto Calibrate button
  const customStyles = `
    @keyframes gentlePulse {
      0%, 100% { 
        box-shadow: 0 0 20px rgba(168, 85, 247, 0.5), 0 0 40px rgba(168, 85, 247, 0.3); 
        border-color: rgba(168, 85, 247, 0.5);
      }
      50% { 
        box-shadow: 0 0 30px rgba(168, 85, 247, 0.8), 0 0 60px rgba(168, 85, 247, 0.5); 
        border-color: rgba(168, 85, 247, 0.8);
      }
    }
  `;
  const navigate = useNavigate();
  const location = useLocation();
  const selectedBusFromState = location.state?.bus as st3215.InferenceState.IBusState | undefined;

  // Use lazy initialization to handle initial state from router
  const [selectedBus] = useState<st3215.InferenceState.IBusState | null>(
    () => selectedBusFromState || null
  );
  const inferenceState = useInferenceState();
  const [resetting, setResetting] = useState(false);
  const [showFreezeConfirmation, setShowFreezeConfirmation] = useState(false);
  const [isSavePending, setIsSavePending] = useState(false);

  const currentBusState = selectedBus
    ? inferenceState?.st3215?.data.buses?.find((b: st3215.InferenceState.IBusState) => b.bus?.serialNumber === selectedBus.bus?.serialNumber) || selectedBus
    : null;
  const isCalibrationFrozen = currentBusState?.motors?.some((motor: st3215.InferenceState.IMotorState) => motor.rangeFreezed) ?? false;
  const [showResetConfirmation, setShowResetConfirmation] = useState(isCalibrationFrozen);
  const getMotorRange = (motor: st3215.InferenceState.IMotorState) => {
    const min = motor.rangeMin ?? 0;
    const max = motor.rangeMax ?? 0;
    return max >= min ? max - min : (4096 - min) + max;
  };
  const motorsWithNarrowRange = currentBusState?.motors?.filter(
    (motor: st3215.InferenceState.IMotorState) => getMotorRange(motor) < MIN_CALIBRATED_RANGE
  ) ?? [];
  const allMotorsNarrow = motorsWithNarrowRange.length === (currentBusState?.motors?.length ?? 0);
  const showMoveOverlay = !isCalibrationFrozen && !showResetConfirmation && allMotorsNarrow;

  const calibrationState = currentBusState?.autoCalibration;
  const isCalibrating = calibrationState?.status === st3215.AutoCalibrationState.Status.IN_PROGRESS;
  const hasValidMotors = currentBusState ? supportsSt3215Device(currentBusState) : false;
  const isSupportedRobot = hasValidMotors;

  // Check voltage across all motors (voltage is in 0.1V units, so 70 = 7.0V)
  const minVoltage = currentBusState?.motors?.reduce((min, motor) => {
    if (!motor.state) return min;
    const voltage = getMotorVoltage(motor.state);
    return voltage > 0 ? Math.min(min, voltage) : min;
  }, 255) ?? 255;
  const isLowVoltage = minVoltage < 70; // Less than 7.0V

  const resetCalibration = async (busSerial: string) => {
    await webSocketManager.commands.sendMirroringCommand({
      type: motors_mirroring.CommandType.CT_STOP_MIRROR,
      source: {
        type: motors_mirroring.BusType.MBT_ST3215,
        uniqueId: busSerial,
      },
    });
    await webSocketManager.commands.sendSt3215Command({
      targetBusSerial: busSerial,
      resetCalibration: { reset: true },
    });
  };

  // Send reset command when the calibration page opens
  useEffect(() => {
    const busSerial = selectedBus?.bus?.serialNumber;
    if (!busSerial) return;
    resetCalibration(busSerial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBus?.bus?.serialNumber]);

  useEffect(() => {
    if (isSavePending && isCalibrationFrozen) {
      navigate('/');
    }
  }, [isCalibrationFrozen, isSavePending, navigate]);


  const handleReset = async () => {
    if (!selectedBus?.bus?.serialNumber) return;
    setResetting(true);
    await resetCalibration(selectedBus.bus.serialNumber);

    // TODO(ab): normal command result wait from inference state
    setTimeout(() => {
      setResetting(false);
      setShowResetConfirmation(false);
    }, 1000);
  };

  const confirmFreeze = async () => {
    if (!selectedBus?.bus?.serialNumber) return;
    await webSocketManager.commands.sendSt3215Command({
      targetBusSerial: selectedBus.bus.serialNumber,
      freezeCalibration: {
        freeze: true
      }
    });
    setShowFreezeConfirmation(false);
    setIsSavePending(true);
  };

  const handleFreeze = () => {
    setShowFreezeConfirmation(true);
  };

  const handleAutoCalibrate = async () => {
    if (!selectedBus?.bus?.serialNumber) return;
    await webSocketManager.commands.sendSt3215Command({
      targetBusSerial: selectedBus.bus.serialNumber,
      autoCalibrate: {
        calibrate: true
      }
    });
  };

  const handleStopCalibration = async () => {
    if (!selectedBus?.bus?.serialNumber) return;
    await webSocketManager.commands.sendSt3215Command({
      targetBusSerial: selectedBus.bus.serialNumber,
      stopAutoCalibrate: {
        stop: true
      }
    });
  };

  if (currentBusState) {
    const renderResetButton = () => (
      <button
        onClick={() => setShowResetConfirmation(true)}
        disabled={!hasValidMotors}
        className={`${actionButtonClasses} bg-accent-critical-bg text-text-primary hover:bg-accent-critical-bg active:scale-95`}
      >
        Reset
      </button>
    );

    const renderCalibrationButton = () => {
      if (!isSupportedRobot) {
        return null;
      }

      if (isCalibrating) {
        return (
          <button
            onClick={handleStopCalibration}
            disabled={!hasValidMotors}
            className={`${wideActionButtonClasses} border-2 border-transparent bg-accent-danger-deep text-text-primary shadow-lg shadow-accent-danger-deep/30 hover:bg-accent-danger-deep hover:scale-105 active:scale-95`}
          >
            Stop Calibration
          </button>
        );
      }

      return (
        <button
          onClick={handleAutoCalibrate}
          disabled={isCalibrationFrozen || !hasValidMotors || isLowVoltage}
          className={`${wideActionButtonClasses} border-2 ${isLowVoltage ? 'border-accent-warning bg-accent-warning-deep shadow-accent-warning/30' : 'border-accent-secondary-deep bg-accent-secondary-bg shadow-accent-secondary-deep/30'} text-text-primary shadow-lg ${isLowVoltage ? 'hover:bg-accent-warning' : 'hover:bg-accent-secondary-deep'} hover:scale-105 active:scale-95`}
          style={{
            animation: isLowVoltage ? undefined : 'gentlePulse 2s ease-in-out infinite'
          }}
        >
          {isLowVoltage ? '⚠️ Auto Calibrate' : '🪄✨ Auto Calibrate'}
        </button>
      );
    };

    const renderSaveButton = () => {
      if (isCalibrationFrozen) {
        return null;
      }

      return (
        <button
          onClick={handleFreeze}
          disabled={!hasValidMotors || isSavePending}
          className={`${actionButtonClasses} bg-accent-info-bg text-text-primary shadow-lg shadow-accent-info-deep/30 hover:bg-accent-info-deep hover:scale-105 active:scale-95`}
        >
          {isSavePending ? <ButtonLoadingLabel label="Saving..." /> : 'Save'}
        </button>
      );
    };

    return (
      <>
        <style>{customStyles}</style>
        <div className="h-screen bg-surface-base text-accent-success font-mono p-6 flex flex-col">
        <div className="container mx-auto flex flex-col h-full overflow-hidden">
          <div className="flex flex-col gap-4 mb-4 flex-shrink-0">
            <Link
              to="/"
              className="self-start px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
            >
              ← Back to Bus List
            </Link>
            <h1 className="text-3xl font-bold text-accent-data">
              Calibrating Bus: {currentBusState.bus?.serialNumber || 'Unknown'}
            </h1>
          </div>

          <div className="flex gap-4 mb-4 flex-col flex-shrink-0">
            <div className="flex flex-col gap-4 sm:hidden">
              {renderCalibrationButton()}
              <div className="grid grid-cols-2 gap-4">
                {renderResetButton()}
                {renderSaveButton()}
              </div>
            </div>

            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
              <div className="flex justify-start">
                {renderResetButton()}
              </div>
              <div className="flex justify-center">
                {renderCalibrationButton()}
              </div>
              <div className="flex justify-end">
                {renderSaveButton()}
              </div>
            </div>
            {!hasValidMotors && (
              <div className="px-4 py-2 bg-accent-warning/10 border border-accent-warning-deep rounded text-accent-warning">
                Power disconnected or motors not detected. Calibration is unavailable.
              </div>
            )}
            {isLowVoltage && hasValidMotors && (
              <div className="px-4 py-2 bg-accent-warning/10 border border-accent-warning-deep rounded text-accent-warning">
                ⚠️ Low voltage detected ({(minVoltage / 10).toFixed(1)}V). Auto calibration is disabled. Please check power supply (requires at least 7.0V).
              </div>
            )}
            {calibrationState && calibrationState.status !== st3215.AutoCalibrationState.Status.IDLE && (
              <div className="px-4 py-2 bg-surface-secondary rounded border border-border-subtle">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-accent-data font-bold">
                    {calibrationState.status === st3215.AutoCalibrationState.Status.IN_PROGRESS && 'Calibrating...'}
                    {calibrationState.status === st3215.AutoCalibrationState.Status.DONE && 'Calibration Complete'}
                    {calibrationState.status === st3215.AutoCalibrationState.Status.FAILED && 'Calibration Failed'}
                    {calibrationState.status === st3215.AutoCalibrationState.Status.STOPPED && 'Calibration Stopped'}
                  </span>
                  {(calibrationState.currentStep ?? 0) > 0 && (
                    <span className="text-text-secondary">
                      Step {calibrationState.currentStep} / {calibrationState.totalSteps}
                    </span>
                  )}
                  {calibrationState.currentPhase && (
                    <span className="text-text-label italic">{calibrationState.currentPhase}</span>
                  )}
                  {calibrationState.errorMessage && (
                    <span className="text-accent-critical">
                      {calibrationState.errorMessage}
                      {calibrationState.status === st3215.AutoCalibrationState.Status.FAILED &&
                        '. Try again or Reset and use manual calibration'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {showFreezeConfirmation && (
            <div className="fixed inset-0 bg-surface-overlay flex items-center justify-center z-50">
              <div className="bg-surface-secondary p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-accent-warning mb-4">Save Calibration</h2>
                <div className="text-text-secondary mb-6">
                  <p>Please confirm:</p>
                  <ul className="list-disc list-inside pl-4 mt-2">
                    <li>The 3D view reflects 100% of your moves.</li>
                    <li>The position for each motor changes from 0% to 100% in all limit cases.</li>
                  </ul>
                </div>
                <div className="flex justify-end gap-4">
                  <button
                    onClick={() => setShowFreezeConfirmation(false)}
                    className="px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmFreeze}
                    disabled={isSavePending}
                    className="px-4 py-2 bg-accent-success-bg text-text-primary rounded hover:bg-accent-success-deep transition-colors"
                  >
                    {isSavePending ? <ButtonLoadingLabel label="Saving..." /> : 'Done'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showResetConfirmation && (
            <div className="fixed inset-0 bg-surface-overlay flex items-center justify-center z-50">
              <div className="bg-surface-secondary p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold text-accent-warning mb-4">Reset Calibration</h2>
                <p className="text-text-secondary mb-6">Are you sure you want to reset the motor calibration? This action cannot be undone.</p>
                <div className="flex justify-end gap-4">
                  <button
                    onClick={() => navigate('/')}
                    className="px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="px-4 py-2 bg-accent-critical-bg text-text-primary rounded hover:bg-accent-critical-deep transition-colors"
                  >
                    {resetting ? 'Resetting...' : 'Reset'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 relative overflow-hidden">
            {showMoveOverlay && !isCalibrating && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface-overlay-light backdrop-blur-sm pointer-events-none">
                <div className="max-w-md text-center px-6 py-8">
                  <p className="text-2xl font-bold text-accent-warning mb-4">
                    Move all motors through their full range
                  </p>
                  <p className="text-text-secondary mb-4">
                    Slowly move each joint from one limit to the other so the 3D view matches your arm's position.
                  </p>
                </div>
              </div>
            )}
            {supportsSt3215Device(currentBusState) ? (
              <BusWebGLRenderer
                busSerialNumber={currentBusState.bus?.serialNumber}
                bus={currentBusState}
                busIndex={0}
                showMotorData={true}
                inCalibrationView={true}
              />
            ) : (
              <div className="relative h-full">
                <div className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-surface-primary/20">
                  <p className="text-accent-warning mb-4 text-center">
                    3D model visualization is only available for registered device modules.
                    <br />
                    This bus has {currentBusState.motors?.length || 0} motor{currentBusState.motors?.length === 1 ? "" : "s"}.
                  </p>
                </div>
                <div className="absolute inset-0 pointer-events-none">
                  <div className="pointer-events-auto">
                    <MotorDataTable 
                      bus={currentBusState} 
                      busIndex={0} 
                      isWebControlled={false} 
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base text-accent-success font-mono p-6">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold text-accent-data mb-4">ST3215 Bus Calibration</h1>
        <p className="text-text-label mb-4">
          No bus selected for calibration. Please go back to the main page and select a bus to calibrate.
        </p>
        <Link
            to="/"
            className="px-4 py-2 bg-surface-elevated text-text-primary rounded hover:bg-surface-active transition-colors"
        >
            ← Back to Bus List
        </Link>
      </div>
    </div>
  );
};

export default St3215BusCalibrationPage;
