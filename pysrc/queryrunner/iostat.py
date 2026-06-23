import subprocess
import psutil

class IOStat:
    def __init__(self, db: str):
        resolve_device: subprocess.CompletedProcess[str] = subprocess.run(["./src/resolve_device.sh", db],
                                    capture_output=True, text=True, check=False)
        if resolve_device.returncode != 0:
            logger.error("Error occurred while mapping DB dir to a device: %s", resolve_device.stderr)
            logger.error("IO statistics will not be captured")
            self.device = None
        else:
            self.device = resolve_device.stdout.split('\n')[0].strip()

    def get_io_stat(self) -> int:
        return None if self.device is None else psutil.disk_io_counters(perdisk=True)[self.device].read_bytes // 1000