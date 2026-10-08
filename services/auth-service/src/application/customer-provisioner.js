class CustomerProvisioner {
  constructor({ repository, customerClient }) {
    this.repository = repository;
    this.customerClient = customerClient;

    this.timer = null;
    this.active = null;
    this.stopped = true;
  }

  async processUid(uid) {
    const job = await this.repository.findCustomerJob(uid);

    if (!job || job.completedAt) {
      return true;
    }

    try {
      await this.customerClient.createCustomer({
        uid: job.uid,
        fullname: job.fullname,
      });

      await this.repository.completeCustomerJob(uid);

      console.log(`Customer provisioning completed: uid=${uid}`);
      return true;
    } catch (error) {
      const message = error.details || error.message;

      await this.repository.recordCustomerJobFailure(uid, message);

      console.error(`Customer provisioning pending: uid=${uid}, ${message}`);

      return false;
    }
  }

  async processPending() {
    const jobs = await this.repository.findPendingCustomerJobs();

    for (const job of jobs) {
      if (this.stopped) break;

      await this.processUid(job.uid);
    }
  }

  start() {
    if (!this.stopped) return;

    this.stopped = false;

    const tick = () => {
      if (this.stopped) return;

      this.active = this.processPending()
        .catch((error) => {
          console.error("Customer retry failed:", error.message);
        })
        .finally(() => {
          this.active = null;

          if (!this.stopped) {
            this.timer = setTimeout(tick, 10000);
          }
        });
    };

    tick();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);

    if (this.active) {
      await this.active;
    }
  }
}

module.exports = { CustomerProvisioner };
