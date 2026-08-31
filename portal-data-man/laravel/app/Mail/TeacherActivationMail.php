<?php

namespace App\Mail;

use App\Models\TeacherAccount;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class TeacherActivationMail extends Mailable
{
    use Queueable,SerializesModels;

    public function __construct(public TeacherAccount $account, public string $setupUrl) {}

    public function build(): self
    {
        return $this->subject('Aktivasi akun Portal Data')->view('mail.teacher-activation');
    }
}
