import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    const validActions = ['download_bible', 'download_supplementary', 'scripture', 'supplementary', 'download_all', 'all'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    const { spawn } = await import('child_process');

    return new Promise<Response>((resolve) => {
      const startTime = Date.now();

      const proc = spawn('docker', [
        'compose',
        'run',
        '--no-TTY',
        '--rm',
        'ingest',
        'python',
        '-m',
        'scripts.run_ingest',
        action,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const fullOutput = (output + errorOutput).trim();

        if (code === 0) {
          resolve(NextResponse.json({
            success: true,
            action,
            output: fullOutput,
            elapsed: `${elapsed}s`,
          }));
        } else {
          resolve(NextResponse.json(
            {
              success: false,
              action,
              output: fullOutput,
              error: `Process exited with code ${code}`,
              elapsed: `${elapsed}s`,
            },
            { status: 500 }
          ));
        }
      });

      proc.on('error', (err) => {
        resolve(NextResponse.json(
          {
            success: false,
            action,
            error: err.message,
            output: output || '',
          },
          { status: 500 }
        ));
      });

      setTimeout(() => {
        proc.kill('SIGTERM');
        resolve(NextResponse.json(
          {
            success: false,
            action,
            error: 'Timed out after 300s',
            output: output || '',
          },
          { status: 500 }
        ));
      }, 300000);
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
