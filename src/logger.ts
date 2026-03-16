export interface OutputChannelLike {
  appendLine(value: string): void;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function formatLine(level: LogLevel, message: string, now: Date): string {
  return `${now.toISOString()} [${level}] ${message}`;
}

class OutputLogger implements Logger {
  public constructor(
    private readonly channel: OutputChannelLike,
    private readonly now: () => Date,
  ) {}

  public debug(message: string): void {
    this.write("DEBUG", message);
  }

  public info(message: string): void {
    this.write("INFO", message);
  }

  public warn(message: string): void {
    this.write("WARN", message);
  }

  public error(message: string): void {
    this.write("ERROR", message);
  }

  private write(level: LogLevel, message: string): void {
    this.channel.appendLine(formatLine(level, message, this.now()));
  }
}

export function createLogger(channel: OutputChannelLike, now: () => Date = () => new Date()): Logger {
  return new OutputLogger(channel, now);
}
